// Coffilot — self-contained JDWP (Java Debug Wire Protocol) client + debug session.
//
// The JVM launched in the Debug lane speaks JDWP natively over a loopback socket
// (started with `-agentlib:jdwp=...,server=y`). This module implements just enough
// of the protocol — in plain Node, with no external debug adapter / DAP server and
// no extra dependencies — for Copilot (or the canvas) to drive a session: set line
// breakpoints, continue, step in/over/out, read the paused stack, inspect locals
// and `this`, and evaluate a variable/field path.
//
// Two layers:
//   * JdwpClient   — the wire protocol: handshake, request/reply correlation,
//                    event packets, and typed wrappers for the command subset used
//                    here. IDs are kept as BigInt (8-byte object/ref/method/frame
//                    IDs overflow JS numbers) and surfaced to callers as strings.
//   * DebugSession — higher-level orchestration on top of JdwpClient: a breakpoint
//                    registry (resolved eagerly for loaded classes and lazily via
//                    CLASS_PREPARE for not-yet-loaded ones), pause state, stack /
//                    locals / evaluate, value formatting, and JSON snapshots.
//
// Everything here is pure (no @github/copilot-sdk, no canvas globals) so it can be
// unit-tested by launching a throwaway `java -agentlib:jdwp=...` process.

import { Socket } from "node:net";

// ---------------------------------------------------------------------------
// Protocol constants (subset)
// ---------------------------------------------------------------------------

const CMD = {
  VirtualMachine: {
    set: 1,
    Version: 1,
    ClassesBySignature: 2,
    AllClasses: 3,
    IDSizes: 7,
    Suspend: 8,
    Resume: 9,
    Capabilities: 12,
    CapabilitiesNew: 17,
  },
  ReferenceType: {
    set: 2,
    Signature: 1,
    Fields: 4,
    Methods: 5,
    SourceFile: 7,
    FieldsWithGeneric: 14,
    MethodsWithGeneric: 15,
  },
  ClassType: { set: 3, Superclass: 1 },
  Method: { set: 6, LineTable: 1, VariableTable: 2, VariableTableWithGeneric: 5 },
  ObjectReference: { set: 9, ReferenceType: 1, GetValues: 2 },
  StringReference: { set: 10, Value: 1 },
  ThreadReference: { set: 11, Name: 1, Resume: 3, Status: 4, Frames: 6, FrameCount: 7 },
  ArrayReference: { set: 13, Length: 1 },
  EventRequest: { set: 15, Set: 1, Clear: 2 },
  Event: { set: 64, Composite: 100 },
};

const EVENT_KIND = {
  SINGLE_STEP: 1,
  BREAKPOINT: 2,
  CLASS_PREPARE: 8,
  THREAD_START: 6,
  THREAD_DEATH: 7,
  VM_START: 90,
  VM_DEATH: 99,
};

const MOD_KIND = { Count: 1, ClassMatch: 5, LocationOnly: 7, Step: 10 };
const SUSPEND = { NONE: 0, EVENT_THREAD: 1, ALL: 2 };
const STEP_DEPTH = { INTO: 0, OVER: 1, OUT: 2 };
const STEP_SIZE = { MIN: 0, LINE: 1 };

// JDWP value tags (first byte of a tagged value / type signature).
const TAG = {
  ARRAY: 91, // [
  BYTE: 66, // B
  CHAR: 67, // C
  OBJECT: 76, // L
  FLOAT: 70, // F
  DOUBLE: 68, // D
  INT: 73, // I
  LONG: 74, // J
  SHORT: 83, // S
  VOID: 86, // V
  BOOLEAN: 90, // Z
  STRING: 115, // s
  THREAD: 116, // t
  THREAD_GROUP: 103, // g
  CLASS_LOADER: 108, // l
  CLASS_OBJECT: 99, // c
};

const HANDSHAKE = Buffer.from("JDWP-Handshake", "ascii");

// ---------------------------------------------------------------------------
// Buffer reader / writer (big-endian, ID-size aware)
// ---------------------------------------------------------------------------

class Writer {
  constructor() {
    this.parts = [];
  }
  u8(v) {
    this.parts.push(Buffer.from([v & 0xff]));
    return this;
  }
  u32(v) {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(v >>> 0, 0);
    this.parts.push(b);
    return this;
  }
  id(value, size) {
    const b = Buffer.alloc(size);
    let v = BigInt.asUintN(size * 8, BigInt(value));
    for (let i = size - 1; i >= 0; i--) {
      b[i] = Number(v & 0xffn);
      v >>= 8n;
    }
    this.parts.push(b);
    return this;
  }
  long(value) {
    return this.id(value, 8);
  }
  string(str) {
    const s = Buffer.from(String(str), "utf8");
    this.u32(s.length);
    this.parts.push(s);
    return this;
  }
  buffer() {
    return Buffer.concat(this.parts);
  }
}

class Reader {
  constructor(buf, sizes) {
    this.buf = buf;
    this.off = 0;
    this.sizes = sizes; // { field, method, object, refType, frame }
  }
  u8() {
    return this.buf.readUInt8(this.off++);
  }
  i32() {
    const v = this.buf.readInt32BE(this.off);
    this.off += 4;
    return v;
  }
  u32() {
    const v = this.buf.readUInt32BE(this.off);
    this.off += 4;
    return v;
  }
  bigUint(size) {
    let v = 0n;
    for (let i = 0; i < size; i++) v = (v << 8n) | BigInt(this.buf[this.off++]);
    return v;
  }
  bigInt(size) {
    return BigInt.asIntN(size * 8, this.bigUint(size));
  }
  long() {
    return this.bigInt(8);
  }
  objectId() {
    return this.bigUint(this.sizes.object);
  }
  refTypeId() {
    return this.bigUint(this.sizes.refType);
  }
  methodId() {
    return this.bigUint(this.sizes.method);
  }
  fieldId() {
    return this.bigUint(this.sizes.field);
  }
  frameId() {
    return this.bigUint(this.sizes.frame);
  }
  string() {
    const len = this.u32();
    const s = this.buf.toString("utf8", this.off, this.off + len);
    this.off += len;
    return s;
  }
  // typeTag(1) + classId(refType) + methodId + index(8)
  location() {
    const tag = this.u8();
    const classId = this.refTypeId();
    const methodId = this.methodId();
    const index = this.long();
    return { tag, classId, methodId, index };
  }
  // A tagged value: tag byte then the value sized by its tag.
  taggedValue() {
    const tag = this.u8();
    return this.untaggedValue(tag);
  }
  untaggedValue(tag) {
    switch (tag) {
      case TAG.BOOLEAN:
        return { tag, value: this.u8() !== 0 };
      case TAG.BYTE:
        return { tag, value: this.buf.readInt8(this.off++) };
      case TAG.CHAR: {
        const v = this.buf.readUInt16BE(this.off);
        this.off += 2;
        return { tag, value: v };
      }
      case TAG.SHORT: {
        const v = this.buf.readInt16BE(this.off);
        this.off += 2;
        return { tag, value: v };
      }
      case TAG.INT:
        return { tag, value: this.i32() };
      case TAG.FLOAT: {
        const v = this.buf.readFloatBE(this.off);
        this.off += 4;
        return { tag, value: v };
      }
      case TAG.LONG:
        return { tag, value: this.long() };
      case TAG.DOUBLE: {
        const v = this.buf.readDoubleBE(this.off);
        this.off += 8;
        return { tag, value: v };
      }
      case TAG.VOID:
        return { tag, value: undefined };
      default:
        // All object-like tags (OBJECT/ARRAY/STRING/THREAD/...): an objectID.
        return { tag, value: this.objectId() };
    }
  }
}

// ---------------------------------------------------------------------------
// JdwpClient — the wire protocol
// ---------------------------------------------------------------------------

export class JdwpClient {
  constructor() {
    this.sock = null;
    this.nextId = 1;
    this.pending = new Map(); // id -> { resolve, reject }
    this.rx = Buffer.alloc(0);
    this.handshook = false;
    this.sizes = { field: 8, method: 8, object: 8, refType: 8, frame: 8 };
    this.onEvent = null; // (composite) => void
    this.onClose = null; // (err?) => void
    this._closed = false;
  }

  // A single connect attempt. Safe to retry on the same instance: per-attempt
  // state is reset here, and a failure *before* the handshake completes only
  // rejects the promise (it does not poison the client or emit onClose), so a
  // caller can keep retrying while the debuggee's JDWP port comes up.
  connect(host, port) {
    return new Promise((resolve, reject) => {
      const sock = new Socket();
      this.sock = sock;
      this.rx = Buffer.alloc(0);
      this.handshook = false;
      this.pending.clear();
      let settled = false;
      sock.setNoDelay(true);
      sock.on("error", (err) => {
        if (!settled) {
          settled = true;
          reject(err);
        } else if (this.handshook) {
          this._fail(err);
        }
      });
      sock.on("close", () => {
        if (this.handshook) this._fail(null);
      });
      sock.on("connect", () => {
        sock.write(HANDSHAKE);
      });
      sock.on("data", (chunk) => {
        if (!this.handshook) {
          this.rx = Buffer.concat([this.rx, chunk]);
          if (this.rx.length < HANDSHAKE.length) return;
          const hs = this.rx.subarray(0, HANDSHAKE.length);
          if (!hs.equals(HANDSHAKE)) {
            settled = true;
            reject(new Error("JDWP handshake failed"));
            sock.destroy();
            return;
          }
          this.handshook = true;
          this.rx = this.rx.subarray(HANDSHAKE.length);
          settled = true;
          resolve();
          if (this.rx.length) this._drain();
          return;
        }
        this.rx = Buffer.concat([this.rx, chunk]);
        this._drain();
      });
      sock.connect(port, host);
    });
  }

  _fail(err) {
    if (this._closed) return;
    this._closed = true;
    for (const { reject } of this.pending.values()) reject(err || new Error("JDWP connection closed"));
    this.pending.clear();
    if (this.onClose) this.onClose(err);
  }

  _drain() {
    // Each packet: length(4) id(4) flags(1) [errorCode(2) | set(1) cmd(1)] data...
    while (this.rx.length >= 11) {
      const len = this.rx.readUInt32BE(0);
      if (this.rx.length < len) return;
      const pkt = this.rx.subarray(0, len);
      this.rx = this.rx.subarray(len);
      const id = pkt.readUInt32BE(4);
      const flags = pkt.readUInt8(8);
      const body = pkt.subarray(11);
      if (flags & 0x80) {
        const errorCode = pkt.readUInt16BE(9);
        const p = this.pending.get(id);
        if (p) {
          this.pending.delete(id);
          if (errorCode !== 0) p.reject(new JdwpError(errorCode));
          else p.resolve(new Reader(Buffer.from(body), this.sizes));
        }
      } else {
        const set = pkt.readUInt8(9);
        const cmd = pkt.readUInt8(10);
        if (set === CMD.Event.set && cmd === CMD.Event.Composite) {
          try {
            const composite = this._parseComposite(new Reader(Buffer.from(body), this.sizes));
            if (this.onEvent) this.onEvent(composite);
          } catch {
            /* ignore malformed event */
          }
        }
      }
    }
  }

  command(set, cmd, payload = Buffer.alloc(0)) {
    return new Promise((resolve, reject) => {
      if (this._closed || !this.sock) return reject(new Error("JDWP connection closed"));
      const id = this.nextId++;
      const len = 11 + payload.length;
      const header = Buffer.alloc(11);
      header.writeUInt32BE(len, 0);
      header.writeUInt32BE(id, 4);
      header.writeUInt8(0, 8);
      header.writeUInt8(set, 9);
      header.writeUInt8(cmd, 10);
      this.pending.set(id, { resolve, reject });
      this.sock.write(Buffer.concat([header, payload]));
    });
  }

  close() {
    this._closed = true;
    try {
      this.sock?.destroy();
    } catch {
      /* ignore */
    }
  }

  _parseComposite(r) {
    const suspendPolicy = r.u8();
    const count = r.i32();
    const events = [];
    for (let i = 0; i < count; i++) {
      const eventKind = r.u8();
      const ev = { eventKind };
      switch (eventKind) {
        case EVENT_KIND.VM_START:
          ev.requestId = r.i32();
          ev.thread = r.objectId();
          break;
        case EVENT_KIND.VM_DEATH:
          ev.requestId = r.i32();
          break;
        case EVENT_KIND.BREAKPOINT:
        case EVENT_KIND.SINGLE_STEP:
          ev.requestId = r.i32();
          ev.thread = r.objectId();
          ev.location = r.location();
          break;
        case EVENT_KIND.CLASS_PREPARE:
          ev.requestId = r.i32();
          ev.thread = r.objectId();
          ev.refTypeTag = r.u8();
          ev.typeId = r.refTypeId();
          ev.signature = r.string();
          ev.status = r.i32();
          break;
        case EVENT_KIND.THREAD_START:
        case EVENT_KIND.THREAD_DEATH:
          ev.requestId = r.i32();
          ev.thread = r.objectId();
          break;
        default:
          // Unknown/unsupported kind: we can't know its size, so stop parsing
          // the rest of this composite (only the parsed events are delivered).
          return { suspendPolicy, events };
      }
      events.push(ev);
    }
    return { suspendPolicy, events };
  }

  // --- Typed command wrappers -------------------------------------------------

  async idSizes() {
    const r = await this.command(CMD.VirtualMachine.set, CMD.VirtualMachine.IDSizes);
    this.sizes = {
      field: r.i32(),
      method: r.i32(),
      object: r.i32(),
      refType: r.i32(),
      frame: r.i32(),
    };
    return this.sizes;
  }

  async version() {
    const r = await this.command(CMD.VirtualMachine.set, CMD.VirtualMachine.Version);
    const description = r.string();
    const jdwpMajor = r.i32();
    const jdwpMinor = r.i32();
    const vmVersion = r.string();
    const vmName = r.string();
    return { description, jdwpMajor, jdwpMinor, vmVersion, vmName };
  }

  async classesBySignature(signature) {
    const payload = new Writer().string(signature).buffer();
    const r = await this.command(CMD.VirtualMachine.set, CMD.VirtualMachine.ClassesBySignature, payload);
    const count = r.i32();
    const out = [];
    for (let i = 0; i < count; i++) {
      const refTypeTag = r.u8();
      const typeId = r.refTypeId();
      const status = r.i32();
      out.push({ refTypeTag, typeId, status });
    }
    return out;
  }

  async resumeVM() {
    await this.command(CMD.VirtualMachine.set, CMD.VirtualMachine.Resume);
  }
  async suspendVM() {
    await this.command(CMD.VirtualMachine.set, CMD.VirtualMachine.Suspend);
  }

  async signature(refTypeId) {
    const payload = new Writer().id(refTypeId, this.sizes.refType).buffer();
    const r = await this.command(CMD.ReferenceType.set, CMD.ReferenceType.Signature, payload);
    return r.string();
  }

  async superclass(classId) {
    const payload = new Writer().id(classId, this.sizes.refType).buffer();
    const r = await this.command(CMD.ClassType.set, CMD.ClassType.Superclass, payload);
    return r.refTypeId(); // 0 for java/lang/Object
  }

  async methods(refTypeId) {
    const payload = new Writer().id(refTypeId, this.sizes.refType).buffer();
    const r = await this.command(CMD.ReferenceType.set, CMD.ReferenceType.MethodsWithGeneric, payload);
    const count = r.i32();
    const out = [];
    for (let i = 0; i < count; i++) {
      const methodId = r.methodId();
      const name = r.string();
      const sig = r.string();
      const generic = r.string();
      const modBits = r.i32();
      out.push({ methodId, name, sig, generic, modBits });
    }
    return out;
  }

  async fields(refTypeId) {
    const payload = new Writer().id(refTypeId, this.sizes.refType).buffer();
    const r = await this.command(CMD.ReferenceType.set, CMD.ReferenceType.FieldsWithGeneric, payload);
    const count = r.i32();
    const out = [];
    for (let i = 0; i < count; i++) {
      const fieldId = r.fieldId();
      const name = r.string();
      const sig = r.string();
      const generic = r.string();
      const modBits = r.i32();
      out.push({ fieldId, name, sig, generic, modBits });
    }
    return out;
  }

  async lineTable(refTypeId, methodId) {
    const payload = new Writer().id(refTypeId, this.sizes.refType).id(methodId, this.sizes.method).buffer();
    const r = await this.command(CMD.Method.set, CMD.Method.LineTable, payload);
    const start = r.long();
    const end = r.long();
    const count = r.i32();
    const lines = [];
    for (let i = 0; i < count; i++) {
      const lineCodeIndex = r.long();
      const lineNumber = r.i32();
      lines.push({ lineCodeIndex, lineNumber });
    }
    return { start, end, lines };
  }

  async variableTable(refTypeId, methodId) {
    const payload = new Writer().id(refTypeId, this.sizes.refType).id(methodId, this.sizes.method).buffer();
    let r;
    try {
      r = await this.command(CMD.Method.set, CMD.Method.VariableTableWithGeneric, payload);
    } catch {
      return null; // no local variable table (compiled without -g)
    }
    const argCnt = r.i32();
    const count = r.i32();
    const slots = [];
    for (let i = 0; i < count; i++) {
      const codeIndex = r.long();
      const name = r.string();
      const sig = r.string();
      const generic = r.string();
      const length = r.i32();
      const slot = r.i32();
      slots.push({ codeIndex, name, sig, generic, length, slot });
    }
    return { argCnt, slots };
  }

  async sourceFile(refTypeId) {
    try {
      const payload = new Writer().id(refTypeId, this.sizes.refType).buffer();
      const r = await this.command(CMD.ReferenceType.set, CMD.ReferenceType.SourceFile, payload);
      return r.string();
    } catch {
      return null;
    }
  }

  async threadName(threadId) {
    const payload = new Writer().id(threadId, this.sizes.object).buffer();
    const r = await this.command(CMD.ThreadReference.set, CMD.ThreadReference.Name, payload);
    return r.string();
  }

  async frames(threadId, start, length) {
    const payload = new Writer()
      .id(threadId, this.sizes.object)
      .u32(start)
      .u32(length >>> 0)
      .buffer();
    const r = await this.command(CMD.ThreadReference.set, CMD.ThreadReference.Frames, payload);
    const count = r.i32();
    const out = [];
    for (let i = 0; i < count; i++) {
      const frameId = r.frameId();
      const location = r.location();
      out.push({ frameId, location });
    }
    return out;
  }

  async frameCount(threadId) {
    const payload = new Writer().id(threadId, this.sizes.object).buffer();
    const r = await this.command(CMD.ThreadReference.set, CMD.ThreadReference.FrameCount, payload);
    return r.i32();
  }

  async resumeThread(threadId) {
    const payload = new Writer().id(threadId, this.sizes.object).buffer();
    await this.command(CMD.ThreadReference.set, CMD.ThreadReference.Resume, payload);
  }

  // StackFrame.GetValues — slots is [{ slot, tag }].
  async getStackValues(threadId, frameId, slots) {
    const w = new Writer().id(threadId, this.sizes.object).id(frameId, this.sizes.frame).u32(slots.length);
    for (const s of slots) w.u32(s.slot).u8(s.tag);
    const r = await this.command(16 /* StackFrame */, 1 /* GetValues */, w.buffer());
    const count = r.i32();
    const out = [];
    for (let i = 0; i < count; i++) out.push(r.taggedValue());
    return out;
  }

  async thisObject(threadId, frameId) {
    const w = new Writer().id(threadId, this.sizes.object).id(frameId, this.sizes.frame);
    const r = await this.command(16 /* StackFrame */, 3 /* ThisObject */, w.buffer());
    return r.taggedValue();
  }

  async objectReferenceType(objectId) {
    const payload = new Writer().id(objectId, this.sizes.object).buffer();
    const r = await this.command(CMD.ObjectReference.set, CMD.ObjectReference.ReferenceType, payload);
    const refTypeTag = r.u8();
    const typeId = r.refTypeId();
    return { refTypeTag, typeId };
  }

  // ObjectReference.GetValues — fieldIds is an array of BigInt field IDs.
  async objectGetValues(objectId, fieldIds) {
    const w = new Writer().id(objectId, this.sizes.object).u32(fieldIds.length);
    for (const f of fieldIds) w.id(f, this.sizes.field);
    const r = await this.command(CMD.ObjectReference.set, CMD.ObjectReference.GetValues, w.buffer());
    const count = r.i32();
    const out = [];
    for (let i = 0; i < count; i++) out.push(r.taggedValue());
    return out;
  }

  async stringValue(stringId) {
    const payload = new Writer().id(stringId, this.sizes.object).buffer();
    const r = await this.command(CMD.StringReference.set, CMD.StringReference.Value, payload);
    return r.string();
  }

  async arrayLength(arrayId) {
    const payload = new Writer().id(arrayId, this.sizes.object).buffer();
    const r = await this.command(CMD.ArrayReference.set, CMD.ArrayReference.Length, payload);
    return r.i32();
  }

  // EventRequest.Set for a class-prepare filter. Returns the requestId.
  async setClassPrepare(classPattern, suspendPolicy = SUSPEND.EVENT_THREAD) {
    const w = new Writer()
      .u8(EVENT_KIND.CLASS_PREPARE)
      .u8(suspendPolicy)
      .u32(1)
      .u8(MOD_KIND.ClassMatch)
      .string(classPattern);
    const r = await this.command(CMD.EventRequest.set, CMD.EventRequest.Set, w.buffer());
    return r.i32();
  }

  // EventRequest.Set for a line breakpoint at a resolved location.
  async setBreakpoint(location, suspendPolicy = SUSPEND.ALL) {
    const w = new Writer()
      .u8(EVENT_KIND.BREAKPOINT)
      .u8(suspendPolicy)
      .u32(1)
      .u8(MOD_KIND.LocationOnly)
      .u8(location.tag)
      .id(location.classId, this.sizes.refType)
      .id(location.methodId, this.sizes.method)
      .long(location.index);
    const r = await this.command(CMD.EventRequest.set, CMD.EventRequest.Set, w.buffer());
    return r.i32();
  }

  // EventRequest.Set for a single step on one thread.
  async setStep(threadId, depth, size = STEP_SIZE.LINE, suspendPolicy = SUSPEND.ALL) {
    const w = new Writer()
      .u8(EVENT_KIND.SINGLE_STEP)
      .u8(suspendPolicy)
      .u32(1)
      .u8(MOD_KIND.Step)
      .id(threadId, this.sizes.object)
      .u32(size)
      .u32(depth);
    const r = await this.command(CMD.EventRequest.set, CMD.EventRequest.Set, w.buffer());
    return r.i32();
  }

  async clearEvent(eventKind, requestId) {
    const w = new Writer().u8(eventKind).u32(requestId >>> 0);
    await this.command(CMD.EventRequest.set, CMD.EventRequest.Clear, w.buffer());
  }
}

export class JdwpError extends Error {
  constructor(code) {
    super(`JDWP error ${code}${JDWP_ERRORS[code] ? " (" + JDWP_ERRORS[code] + ")" : ""}`);
    this.code = code;
  }
}

const JDWP_ERRORS = {
  10: "INVALID_THREAD",
  13: "THREAD_NOT_SUSPENDED",
  20: "INVALID_OBJECT",
  21: "INVALID_CLASS",
  23: "INVALID_METHODID",
  24: "INVALID_LOCATION",
  30: "INVALID_FRAMEID",
  31: "NO_MORE_FRAMES",
  35: "ABSENT_INFORMATION",
  99: "NOT_IMPLEMENTED",
  101: "VM_DEAD",
};

// ---------------------------------------------------------------------------
// Signature helpers
// ---------------------------------------------------------------------------

// JNI class signature ("Lcom/example/App;") <-> binary name ("com.example.App").
function classNameToSignature(name) {
  return "L" + String(name).replace(/\./g, "/") + ";";
}
function signatureToClassName(sig) {
  const m = /^L(.+);$/.exec(sig);
  return m ? m[1].replace(/\//g, ".") : sig;
}

// Human-readable type from a field/variable JNI signature (best-effort).
function typeFromSignature(sig) {
  if (!sig) return "";
  let dims = 0;
  let s = sig;
  while (s[0] === "[") {
    dims++;
    s = s.slice(1);
  }
  const base =
    {
      B: "byte",
      C: "char",
      D: "double",
      F: "float",
      I: "int",
      J: "long",
      S: "short",
      Z: "boolean",
      V: "void",
    }[s] || (s[0] === "L" ? signatureToClassName(s).replace(/^java\.lang\./, "") : s);
  return base + "[]".repeat(dims);
}

// The value tag implied by a variable/field signature's first char.
function tagFromSignature(sig) {
  const c = sig[0];
  if (c === "[") return TAG.ARRAY;
  if (c === "L") return TAG.OBJECT;
  return c.charCodeAt(0); // B C D F I J S Z map straight to their tag bytes
}

// ---------------------------------------------------------------------------
// DebugSession — orchestration on top of JdwpClient
// ---------------------------------------------------------------------------

export class DebugSession {
  constructor({ log, onPaused, onResumed, onClosed, onBreakpoints } = {}) {
    this.client = new JdwpClient();
    this.log = log || (() => {});
    this.onPaused = onPaused || (() => {});
    this.onResumed = onResumed || (() => {});
    this.onClosed = onClosed || (() => {});
    this.onBreakpoints = onBreakpoints || (() => {});

    this.active = false;
    this.paused = false;
    this.stoppedReason = null; // "breakpoint" | "step" | "pause"
    this.thread = null; // BigInt threadId of the stopped thread
    this.threadNameStr = null;
    this.frameCache = []; // resolved frames for the current stop
    this.bpSeq = 1;
    this.breakpoints = []; // { id, className, line, verified, error, requestId, classPrepareId, location }
    this._sigCache = new Map(); // refTypeId(string) -> className
    this._methodsCache = new Map(); // refTypeId(string) -> methods[]
    this._stepRequest = null; // active step requestId
  }

  // Connect with retry: the debuggee's JDWP port only opens once the agent has
  // initialized (early in startup), so we poll until the socket accepts us (or we
  // run out of attempts). `signal` is an optional { aborted } flag the caller can
  // flip to stop early (e.g. if the launch is cancelled).
  async connect(host, port, { retries = 200, delayMs = 150, signal = null } = {}) {
    this.client.onEvent = (c) => this._onEvent(c).catch((e) => this.log(`event error: ${e.message}`));
    this.client.onClose = () => this._onClose();
    // Allow reuse after a previous VM exited: clear the stale stop/close state and
    // each breakpoint's per-session install handles so they re-arm on the new VM.
    this._closedEmitted = false;
    this.paused = false;
    this.frameCache = [];
    for (const bp of this.breakpoints) {
      bp.requestId = null;
      bp.classPrepareId = null;
      bp.verified = false;
      bp.error = null;
    }
    let lastErr = null;
    for (let i = 0; i < retries; i++) {
      if (signal && signal.aborted) throw new Error("debug attach cancelled");
      try {
        await this.client.connect(host, port);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    if (lastErr) throw new Error(`could not connect to the debuggee on ${host}:${port}: ${lastErr.message}`);
    await this.client.idSizes();
    this.active = true;
    const v = await this.client.version().catch(() => null);
    if (v) this.log(`connected to ${v.vmName} ${v.vmVersion} (JDWP ${v.jdwpMajor}.${v.jdwpMinor})`);
    // Re-resolve any breakpoints added before connect, then make sure the VM is
    // running (a suspend=y launch starts suspended at VM_START).
    for (const bp of this.breakpoints) await this._installBreakpoint(bp).catch(() => {});
    await this.client.resumeVM().catch(() => {});
    return v;
  }

  _onClose() {
    if (!this.active && this._closedEmitted) return;
    this.active = false;
    this.paused = false;
    this._closedEmitted = true;
    this.onClosed();
  }

  dispose() {
    try {
      this.client.close();
    } catch {
      /* ignore */
    }
  }

  // --- Events ----------------------------------------------------------------

  async _onEvent(composite) {
    for (const ev of composite.events) {
      if (ev.eventKind === EVENT_KIND.CLASS_PREPARE) {
        await this._onClassPrepare(ev);
      } else if (ev.eventKind === EVENT_KIND.BREAKPOINT) {
        await this._onStop(ev, "breakpoint");
      } else if (ev.eventKind === EVENT_KIND.SINGLE_STEP) {
        if (this._stepRequest != null) {
          await this.client.clearEvent(EVENT_KIND.SINGLE_STEP, this._stepRequest).catch(() => {});
          this._stepRequest = null;
        }
        await this._onStop(ev, "step");
      } else if (ev.eventKind === EVENT_KIND.VM_DEATH) {
        this.log("the debuggee VM exited");
        this._onClose();
      }
    }
  }

  // A class we have a pending breakpoint for just loaded: resolve + arm it, then
  // let the (briefly EVENT_THREAD-suspended) loading thread continue.
  async _onClassPrepare(ev) {
    const className = signatureToClassName(ev.signature);
    let armed = false;
    for (const bp of this.breakpoints) {
      if (bp.verified) continue;
      if (bp.className === className || className.startsWith(bp.className + "$")) {
        await this._armBreakpointInClass(bp, ev.typeId).catch((e) => {
          bp.error = e.message;
        });
        if (bp.verified) armed = true;
      }
    }
    if (armed) this.onBreakpoints();
    // Resume just the thread the class-prepare suspended (EVENT_THREAD policy).
    await this.client.resumeThread(ev.thread).catch(() => {});
  }

  async _onStop(ev, reason) {
    this.paused = true;
    this.stoppedReason = reason;
    this.thread = ev.thread;
    this.threadNameStr = await this.client.threadName(ev.thread).catch(() => "thread");
    this.frameCache = await this._resolveStack(ev.thread).catch(() => []);
    const top = this.frameCache[0];
    this.log(
      `paused on ${reason}` +
        (top ? ` at ${top.className}.${top.methodName}` + (top.line > 0 ? `:${top.line}` : "") : ""),
    );
    this.onPaused(this.snapshot());
  }

  // --- Breakpoints -----------------------------------------------------------

  // Register a breakpoint. Resolves immediately for already-loaded classes and
  // always installs a CLASS_PREPARE filter so a not-yet-loaded (or reloaded)
  // class arms it on load. Returns the breakpoint record.
  async addBreakpoint(className, line) {
    const existing = this.breakpoints.find((b) => b.className === className && b.line === line);
    if (existing) return existing;
    const bp = {
      id: this.bpSeq++,
      className,
      line,
      verified: false,
      error: null,
      requestId: null,
      classPrepareId: null,
    };
    this.breakpoints.push(bp);
    if (this.active) await this._installBreakpoint(bp).catch((e) => (bp.error = e.message));
    this.onBreakpoints();
    return bp;
  }

  async _installBreakpoint(bp) {
    // Catch the class loading in the future (covers reload + not-yet-loaded).
    if (bp.classPrepareId == null) {
      bp.classPrepareId = await this.client.setClassPrepare(bp.className).catch(() => null);
      // Also watch nested types (Outer$Inner) so a breakpoint inside a lambda /
      // inner class still arms.
      await this.client.setClassPrepare(bp.className + "$*").catch(() => {});
    }
    // Arm now if the class is already loaded.
    const loaded = await this.client.classesBySignature(classNameToSignature(bp.className)).catch(() => []);
    for (const c of loaded) {
      await this._armBreakpointInClass(bp, c.typeId).catch((e) => (bp.error = e.message));
      if (bp.verified) break;
    }
  }

  async _armBreakpointInClass(bp, refTypeId) {
    const methods = await this._methodsOf(refTypeId);
    for (const m of methods) {
      const lt = await this.client.lineTable(refTypeId, m.methodId).catch(() => null);
      if (!lt || !lt.lines.length) continue;
      const match = lt.lines.find((l) => l.lineNumber === bp.line);
      if (!match) continue;
      const location = { tag: 1 /* CLASS */, classId: refTypeId, methodId: m.methodId, index: match.lineCodeIndex };
      bp.requestId = await this.client.setBreakpoint(location);
      bp.location = location;
      bp.verified = true;
      bp.error = null;
      this.log(`breakpoint #${bp.id} armed at ${bp.className}:${bp.line}`);
      return;
    }
  }

  async removeBreakpoint(id) {
    const idx = this.breakpoints.findIndex((b) => b.id === id);
    if (idx < 0) return false;
    const bp = this.breakpoints[idx];
    if (this.active && bp.requestId != null) {
      await this.client.clearEvent(EVENT_KIND.BREAKPOINT, bp.requestId).catch(() => {});
    }
    if (this.active && bp.classPrepareId != null) {
      await this.client.clearEvent(EVENT_KIND.CLASS_PREPARE, bp.classPrepareId).catch(() => {});
    }
    this.breakpoints.splice(idx, 1);
    this.onBreakpoints();
    return true;
  }

  listBreakpoints() {
    return this.breakpoints.map((b) => ({
      id: b.id,
      class: b.className,
      line: b.line,
      verified: b.verified,
      error: b.error || null,
    }));
  }

  // --- Execution control -----------------------------------------------------

  async resume() {
    if (!this.active) return { ok: false, error: "No debug session." };
    this.paused = false;
    this.frameCache = [];
    await this.client.resumeVM();
    this.onResumed();
    return { ok: true };
  }

  async step(depth) {
    if (!this.active) return { ok: false, error: "No debug session." };
    if (!this.paused || this.thread == null) return { ok: false, error: "The app is not paused." };
    const d = depth === "into" ? STEP_DEPTH.INTO : depth === "out" ? STEP_DEPTH.OUT : STEP_DEPTH.OVER;
    this._stepRequest = await this.client.setStep(this.thread, d);
    this.paused = false;
    this.frameCache = [];
    await this.client.resumeVM();
    this.onResumed();
    return { ok: true, depth: depth || "over" };
  }

  // Suspend the running VM to inspect it (the "pause" button).
  async pause() {
    if (!this.active) return { ok: false, error: "No debug session." };
    if (this.paused) return { ok: true, alreadyPaused: true };
    await this.client.suspendVM();
    // Pick a thread with frames to present (prefer "main").
    const ev = await this._pickSuspendedThread();
    if (!ev) {
      await this.client.resumeVM().catch(() => {});
      return { ok: false, error: "Could not find a thread to inspect." };
    }
    await this._onStop({ thread: ev }, "pause");
    return { ok: true };
  }

  async _pickSuspendedThread() {
    // ThreadReference list isn't fetched here; rely on the last known thread, or
    // fall back to scanning all threads via VM.AllThreads.
    const r = await this.client.command(CMD.VirtualMachine.set, 4 /* AllThreads */).catch(() => null);
    if (!r) return this.thread;
    const count = r.i32();
    const threads = [];
    for (let i = 0; i < count; i++) threads.push(r.objectId());
    let best = null;
    for (const t of threads) {
      const n = await this.client.threadName(t).catch(() => "");
      const fc = await this.client.frameCount(t).catch(() => 0);
      if (fc > 0 && (best === null || n === "main")) best = t;
      if (n === "main" && fc > 0) return t;
    }
    return best || this.thread;
  }

  // --- Stack / locals / evaluate --------------------------------------------

  async _resolveStack(threadId, max = 50) {
    // Clamp to the thread's actual depth: some JVMs reject a Frames request whose
    // length exceeds the number of frames currently on the stack.
    const total = await this.client.frameCount(threadId).catch(() => 0);
    const n = Math.min(max, total);
    if (n <= 0) return [];
    const frames = await this.client.frames(threadId, 0, n);
    const out = [];
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      const className = await this._classNameOf(f.location.classId);
      const { name: methodName, line } = await this._methodAndLine(f.location);
      out.push({
        index: i,
        frameId: f.frameId,
        className,
        methodName,
        line,
        location: f.location,
        native: f.location.index === -1n,
      });
    }
    return out;
  }

  async stack() {
    if (!this.paused) return { paused: false, frames: [] };
    return { paused: true, thread: this.threadNameStr, frames: this.frameCache.map((f) => this._publicFrame(f)) };
  }

  _publicFrame(f) {
    return { index: f.index, class: f.className, method: f.methodName, line: f.line, native: f.native };
  }

  async locals(frameIndex = 0) {
    if (!this.paused) return { ok: false, error: "The app is not paused." };
    const frame = this.frameCache[frameIndex];
    if (!frame) return { ok: false, error: `No frame at index ${frameIndex}.` };
    const out = { ok: true, frame: this._publicFrame(frame), variables: [] };

    // `this` (instance methods only).
    const self = await this.client.thisObject(this.thread, frame.frameId).catch(() => null);
    if (self && self.value && self.value !== 0n) {
      out.variables.push({ name: "this", value: await this._format(self), type: await this._typeOfObject(self.value) });
    }

    const vt = await this.client.variableTable(frame.location.classId, frame.location.methodId).catch(() => null);
    if (vt && vt.slots.length) {
      const idx = frame.location.index;
      const visible = vt.slots.filter((s) => idx >= s.codeIndex && idx < s.codeIndex + BigInt(s.length));
      const slots = visible.map((s) => ({ slot: s.slot, tag: tagFromSignature(s.sig) }));
      let values = [];
      if (slots.length) values = await this.client.getStackValues(this.thread, frame.frameId, slots).catch(() => []);
      for (let i = 0; i < visible.length; i++) {
        const s = visible[i];
        if (s.name === "this") continue;
        out.variables.push({
          name: s.name,
          value: await this._format(values[i]),
          type: typeFromSignature(s.sig),
        });
      }
    } else {
      out.note = "No local variable table (compile with -g / debug info for locals).";
    }
    return out;
  }

  // Evaluate a simple variable / dotted field path (e.g. "user.name") against the
  // selected frame. Not a Java expression compiler — it resolves a local (or
  // `this`) then walks instance fields.
  async evaluate(expression, frameIndex = 0) {
    if (!this.paused) return { ok: false, error: "The app is not paused." };
    const frame = this.frameCache[frameIndex];
    if (!frame) return { ok: false, error: `No frame at index ${frameIndex}.` };
    const path = String(expression || "")
      .trim()
      .split(".")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!path.length) return { ok: false, error: "Empty expression." };

    let current = await this._resolveRoot(frame, path[0]);
    if (!current) return { ok: false, error: `Unknown variable '${path[0]}'.` };
    for (let i = 1; i < path.length; i++) {
      if (!current.value || current.tag === undefined || isPrimitiveTag(current.tag)) {
        return { ok: false, error: `'${path.slice(0, i).join(".")}' is not an object.` };
      }
      const next = await this._fieldValue(current.value, path[i]);
      if (!next) return { ok: false, error: `No field '${path[i]}' on '${path.slice(0, i).join(".")}'.` };
      current = next;
    }
    return {
      ok: true,
      expression: path.join("."),
      value: await this._format(current),
      type:
        current.value && !isPrimitiveTag(current.tag)
          ? await this._typeOfObject(current.value)
          : typeFromTag(current.tag),
    };
  }

  async _resolveRoot(frame, name) {
    if (name === "this") {
      const self = await this.client.thisObject(this.thread, frame.frameId).catch(() => null);
      return self && self.value ? self : null;
    }
    const vt = await this.client.variableTable(frame.location.classId, frame.location.methodId).catch(() => null);
    if (vt) {
      const idx = frame.location.index;
      const match = vt.slots.find((s) => s.name === name && idx >= s.codeIndex && idx < s.codeIndex + BigInt(s.length));
      if (match) {
        const values = await this.client.getStackValues(this.thread, frame.frameId, [
          { slot: match.slot, tag: tagFromSignature(match.sig) },
        ]);
        return values[0];
      }
    }
    // Fall back to a field on `this`.
    const self = await this.client.thisObject(this.thread, frame.frameId).catch(() => null);
    if (self && self.value && self.value !== 0n) return this._fieldValue(self.value, name);
    return null;
  }

  async _fieldValue(objectId, fieldName) {
    // Walk the type + superclasses for the named field.
    let refTypeId = (await this.client.objectReferenceType(objectId).catch(() => null))?.typeId;
    while (refTypeId && refTypeId !== 0n) {
      const fields = await this.client.fields(refTypeId).catch(() => []);
      const f = fields.find((x) => x.name === fieldName);
      if (f) {
        const values = await this.client.objectGetValues(objectId, [f.fieldId]).catch(() => []);
        return values[0] || null;
      }
      refTypeId = await this.client.superclass(refTypeId).catch(() => 0n);
    }
    return null;
  }

  // --- Value formatting ------------------------------------------------------

  async _format(v) {
    if (!v) return "<unknown>";
    const { tag, value } = v;
    switch (tag) {
      case TAG.BOOLEAN:
        return String(value);
      case TAG.BYTE:
      case TAG.SHORT:
      case TAG.INT:
        return String(value);
      case TAG.LONG:
        return value.toString();
      case TAG.FLOAT:
      case TAG.DOUBLE:
        return String(value);
      case TAG.CHAR:
        return `'${String.fromCharCode(Number(value))}' (${value})`;
      case TAG.VOID:
        return "void";
      case TAG.STRING: {
        if (!value || value === 0n) return "null";
        const s = await this.client.stringValue(value).catch(() => null);
        return s == null ? `String(id=${value})` : JSON.stringify(s);
      }
      case TAG.ARRAY: {
        if (!value || value === 0n) return "null";
        const len = await this.client.arrayLength(value).catch(() => null);
        const t = await this._typeOfObject(value);
        return len == null ? `${t}` : `${t.replace(/\[\]$/, "")}[${len}]`;
      }
      default: {
        if (!value || value === 0n) return "null";
        // A non-array object: show its type + a stable id. Strings sometimes come
        // back tagged OBJECT, so special-case java.lang.String.
        const type = await this._typeOfObject(value);
        if (type === "String") {
          const s = await this.client.stringValue(value).catch(() => null);
          if (s != null) return JSON.stringify(s);
        }
        return `${type} (id=${value})`;
      }
    }
  }

  async _typeOfObject(objectId) {
    if (!objectId || objectId === 0n) return "null";
    const rt = await this.client.objectReferenceType(objectId).catch(() => null);
    if (!rt) return "Object";
    return (await this._classNameOf(rt.typeId)).replace(/^java\.lang\./, "");
  }

  // --- Caches / helpers ------------------------------------------------------

  async _classNameOf(refTypeId) {
    const key = refTypeId.toString();
    if (this._sigCache.has(key)) return this._sigCache.get(key);
    const sig = await this.client.signature(refTypeId).catch(() => null);
    const name = sig ? signatureToClassName(sig) : `type#${key}`;
    this._sigCache.set(key, name);
    return name;
  }

  async _methodsOf(refTypeId) {
    const key = refTypeId.toString();
    if (this._methodsCache.has(key)) return this._methodsCache.get(key);
    const methods = await this.client.methods(refTypeId);
    this._methodsCache.set(key, methods);
    return methods;
  }

  async _methodAndLine(location) {
    if (location.index === -1n) return { name: "(native)", line: -1 };
    const methods = await this._methodsOf(location.classId).catch(() => []);
    const m = methods.find((x) => x.methodId === location.methodId);
    const name = m ? m.name : "?";
    let line = -1;
    const lt = await this.client.lineTable(location.classId, location.methodId).catch(() => null);
    if (lt && lt.lines.length) {
      let best = null;
      for (const l of lt.lines) {
        if (l.lineCodeIndex <= location.index && (best === null || l.lineCodeIndex > best.lineCodeIndex)) best = l;
      }
      if (best) line = best.lineNumber;
    }
    return { name, line };
  }

  // --- Snapshot --------------------------------------------------------------

  snapshot() {
    const top = this.frameCache[0];
    return {
      active: this.active,
      paused: this.paused,
      stoppedReason: this.stoppedReason,
      thread: this.threadNameStr,
      location: top ? { class: top.className, method: top.methodName, line: top.line } : null,
      frames: this.frameCache.map((f) => this._publicFrame(f)),
      breakpoints: this.listBreakpoints(),
    };
  }
}

function isPrimitiveTag(tag) {
  return (
    tag === TAG.BOOLEAN ||
    tag === TAG.BYTE ||
    tag === TAG.CHAR ||
    tag === TAG.SHORT ||
    tag === TAG.INT ||
    tag === TAG.LONG ||
    tag === TAG.FLOAT ||
    tag === TAG.DOUBLE ||
    tag === TAG.VOID
  );
}

function typeFromTag(tag) {
  const map = {
    [TAG.BOOLEAN]: "boolean",
    [TAG.BYTE]: "byte",
    [TAG.CHAR]: "char",
    [TAG.SHORT]: "short",
    [TAG.INT]: "int",
    [TAG.LONG]: "long",
    [TAG.FLOAT]: "float",
    [TAG.DOUBLE]: "double",
    [TAG.STRING]: "String",
  };
  return map[tag] || "Object";
}

export const _internals = { classNameToSignature, signatureToClassName, typeFromSignature, tagFromSignature, TAG };
