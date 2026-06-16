// Extension: coffilot
//
// Coffilot — a GitHub Copilot canvas extension that turns a Maven-based Java /
// Spring Boot project into an interactive console: Build, Test, Package, Run and
// Stop the app, watch Maven output stream live, and — once the app is up — read
// live JVM metrics from the richest source available (BootUI → Actuator →
// process). Failures surface a "Fix with Copilot" button that pushes the error
// context back into the chat.
//
// Metrics tiers:
//   * Build / test / package / run orchestration (shelling out to ./mvnw) lives
//     here in the Node process.
//   * Live JVM metrics are read from a running app: when the app exposes BootUI
//     (https://github.com/jdubois/boot-ui) it serves sanitized record DTOs at
//     /bootui/api/overview, /live-memory, /health, /threads, which this canvas
//     proxies and renders; otherwise it falls back to Actuator, then to coarse
//     process metrics. BootUI also unlocks the MCP advisor-scan panel.

import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, watch as fsWatch } from "node:fs";
import { spawn } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, joinSession } from "@github/copilot-sdk/extension";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Session + workspace wiring
// ---------------------------------------------------------------------------

const session = await joinSession({ canvases: [makeCanvas()] });

// Resolve the Maven project root. session.workspacePath points at the session
// artifacts folder, not the repo, so we walk up from this extension's own
// location (it lives at <repo>/.github/extensions/coffilot) until we find
// the directory that owns the Maven wrapper, then fall back gracefully.
const workspacePath = findProjectRoot();
const mvnw = path.join(workspacePath, process.platform === "win32" ? "mvnw.cmd" : "mvnw");

// Silence the JDK native-access warnings (JEP 472) that Jansi (Maven's native
// console) and FFM-using app dependencies emit at startup. The flag exists
// since JDK 16, so it's safe for the Java 17+ toolchain and apps this canvas
// runs. Applied to the Maven JVM (via MAVEN_OPTS) and the launched app JVM.
const NATIVE_ACCESS_FLAG = "--enable-native-access=ALL-UNNAMED";

// Merge the native-access flag into MAVEN_OPTS so the Maven JVM doesn't print
// restricted-method warnings, while preserving any MAVEN_OPTS the user has set.
function mavenEnv() {
  const existing = process.env.MAVEN_OPTS ? process.env.MAVEN_OPTS.trim() + " " : "";
  return { ...process.env, MAVEN_OPTS: existing + NATIVE_ACCESS_FLAG };
}

// "Keep JVM warm" uses the Maven Daemon (mvnd) when available: mvnd keeps a pool
// of warm JVMs alive between invocations, so repeated build/test runs skip JVM
// startup + JIT warmup. We auto-detect it and fall back to ./mvnw otherwise.
const isWindows = process.platform === "win32";

let mvndInfo = null;
function detectMvnd() {
  if (mvndInfo && mvndInfo.available) return mvndInfo;
  // Executable names differ by platform: Windows ships mvnd.cmd / mvnd.exe.
  const exeNames = isWindows ? ["mvnd.cmd", "mvnd.exe", "mvnd.bat"] : ["mvnd"];
  const candidates = [];
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    for (const exe of exeNames) candidates.push(path.join(dir, exe));
  }
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (isWindows) {
    // Common Windows install locations (scoop, chocolatey, SDKMAN under Git Bash).
    if (home) {
      candidates.push(
        path.join(home, "scoop", "shims", "mvnd.cmd"),
        path.join(home, "scoop", "shims", "mvnd.exe"),
        path.join(home, ".sdkman", "candidates", "mvnd", "current", "bin", "mvnd.cmd"),
      );
    }
    if (process.env.ProgramData) {
      candidates.push(path.join(process.env.ProgramData, "chocolatey", "bin", "mvnd.exe"));
    }
  } else {
    candidates.push(
      "/opt/homebrew/bin/mvnd",
      "/usr/local/bin/mvnd",
      "/usr/bin/mvnd",
      "/home/linuxbrew/.linuxbrew/bin/mvnd",
    );
    if (home) candidates.push(path.join(home, ".sdkman/candidates/mvnd/current/bin/mvnd"));
  }
  for (const c of candidates) {
    try {
      if (existsSync(c)) {
        mvndInfo = { available: true, path: c };
        return mvndInfo;
      }
    } catch {
      /* ignore */
    }
  }
  mvndInfo = { available: false, path: null };
  return mvndInfo;
}

// When a project ships a pom.xml but no Maven wrapper, fall back to a system
// `mvn` discovered on PATH (and common install locations) so Coffilot still
// works. The wrapper is always preferred when present because it pins the Maven
// version; `mvn` is the graceful fallback.
let mvnInfo = null;
function detectMvn() {
  if (mvnInfo) return mvnInfo;
  // Windows resolves `mvn` to a batch script (mvn.cmd / mvn.bat) or a shim exe.
  const exeNames = isWindows ? ["mvn.cmd", "mvn.bat", "mvn.exe", "mvn"] : ["mvn"];
  const candidates = [];
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    for (const exe of exeNames) candidates.push(path.join(dir, exe));
  }
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (isWindows) {
    if (home) {
      candidates.push(
        path.join(home, "scoop", "shims", "mvn.cmd"),
        path.join(home, "scoop", "shims", "mvn.exe"),
        path.join(home, ".sdkman", "candidates", "maven", "current", "bin", "mvn.cmd"),
      );
    }
    if (process.env.ProgramData) {
      candidates.push(path.join(process.env.ProgramData, "chocolatey", "bin", "mvn.exe"));
    }
  } else {
    candidates.push(
      "/opt/homebrew/bin/mvn",
      "/usr/local/bin/mvn",
      "/usr/bin/mvn",
      "/home/linuxbrew/.linuxbrew/bin/mvn",
    );
    if (home) candidates.push(path.join(home, ".sdkman/candidates/maven/current/bin/mvn"));
  }
  for (const c of candidates) {
    try {
      if (existsSync(c)) {
        mvnInfo = { available: true, path: c };
        return mvnInfo;
      }
    } catch {
      /* ignore */
    }
  }
  mvnInfo = { available: false, path: null };
  return mvnInfo;
}

// The base (non-daemon) Maven command for a run: the project's wrapper when it
// exists, else a system `mvn` from PATH. mvnd layers on top of this for warm
// builds. Cached because neither the wrapper's presence nor PATH change at
// runtime.
let baseRunnerInfo = null;
function baseRunner() {
  if (baseRunnerInfo) return baseRunnerInfo;
  if (existsSync(mvnw)) {
    baseRunnerInfo = { bin: mvnw, label: "./mvnw" };
  } else {
    const m = detectMvn();
    // Fall back to system `mvn`; if that's missing too, keep pointing at the
    // wrapper path so the spawn fails with a clear ENOENT in the lane console.
    baseRunnerInfo = m.available ? { bin: m.path, label: "mvn" } : { bin: mvnw, label: "./mvnw" };
  }
  return baseRunnerInfo;
}

/** Platform-appropriate guidance for installing mvnd, shown when it's missing. */
function mvndInstallHint() {
  const url = "https://github.com/apache/maven-mvnd#how-to-install-mvnd";
  if (isWindows) {
    // No single reliable one-liner on native Windows; point at the download/docs
    // (SDKMAN only works under WSL/Git Bash).
    return { os: "Windows", cmd: null, url };
  }
  if (process.platform === "darwin") {
    return { os: "macOS", cmd: "brew install mvndaemon/homebrew-mvnd/mvnd", url };
  }
  return { os: "Linux", cmd: "sdk install mvnd", url };
}

/**
 * Open an external URL in the user's default browser. The canvas iframe has no
 * privileged bridge to the host, so <a target="_blank"> can't reach a browser;
 * we shell out to the platform opener instead. Only http(s) is allowed, and the
 * URL is always passed as a single argv (no shell) to avoid command injection.
 */
function openExternalUrl(target) {
  let u;
  try {
    u = new URL(String(target));
  } catch {
    return { ok: false, error: "Invalid URL" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, error: "Only http(s) URLs can be opened" };
  }
  let cmd;
  let args;
  if (process.platform === "darwin") {
    cmd = "open";
    args = [u.href];
  } else if (isWindows) {
    // rundll32 receives the URL as a single argv and hands it to the default
    // browser, sidestepping cmd.exe's parsing of `&` in query strings.
    cmd = "rundll32";
    args = ["url.dll,FileProtocolHandler", u.href];
  } else {
    cmd = "xdg-open";
    args = [u.href];
  }
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
    return { ok: true, url: u.href };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Pick the Maven binary for a build/test run. mvnd only when warm + available. */
function resolveRunner(warm) {
  if (warm) {
    const m = detectMvnd();
    if (m.available) return { bin: m.path, label: "mvnd", warm: true };
  }
  const b = baseRunner();
  return { bin: b.bin, label: b.label, warm: false };
}

/** Reserve a free loopback TCP port (for "Use a random HTTP port"). */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function findProjectRoot() {
  const wrapper = process.platform === "win32" ? "mvnw.cmd" : "mvnw";
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, wrapper)) || existsSync(path.join(dir, "pom.xml"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (session.workspacePath && existsSync(path.join(session.workspacePath, wrapper))) {
    return session.workspacePath;
  }
  return session.workspacePath || process.cwd();
}

// ---------------------------------------------------------------------------
// Persistent settings (per project): saved automatically when changed so the
// console remembers the developer's preferences across reloads/sessions. Stored
// under COPILOT_HOME (not the repo) keyed by a hash of the workspace path.
// ---------------------------------------------------------------------------

const SETTINGS_KEYS = ["warm", "springProfiles", "devtools", "randomPort", "openBrowser"];

function settingsPaths() {
  const home = process.env.COPILOT_HOME || path.join(os.homedir(), ".copilot");
  const dir = path.join(home, "extensions", "coffilot", "artifacts");
  const key = createHash("sha1").update(workspacePath).digest("hex").slice(0, 16);
  return { dir, file: path.join(dir, `settings-${key}.json`) };
}

function defaultSettings() {
  return {
    warm: detectMvnd().available, // on by default when the Maven Daemon is available
    springProfiles: "dev",
    devtools: false,
    randomPort: false,
    openBrowser: false,
  };
}

function loadSettings() {
  const base = defaultSettings();
  try {
    const saved = JSON.parse(readFileSync(settingsPaths().file, "utf8"));
    for (const k of SETTINGS_KEYS) if (k in saved) base[k] = saved[k];
  } catch {
    /* no saved settings yet */
  }
  return base;
}

function persistSettings() {
  try {
    const { dir, file } = settingsPaths();
    mkdirSync(dir, { recursive: true });
    const out = {};
    for (const k of SETTINGS_KEYS) out[k] = settings[k];
    writeFileSync(file, JSON.stringify(out, null, 2));
  } catch (e) {
    session.log(`[coffilot] failed to persist settings: ${e.message}`, { level: "warn" });
  }
}

function settingsSnapshot() {
  const out = {};
  for (const k of SETTINGS_KEYS) out[k] = settings[k];
  return out;
}

// Previous foreground (full-reactor) test total, persisted so the Tests
// progress bar stays determinate across extension reloads / restarts.
function lastTestTotalFile() {
  const { dir } = settingsPaths();
  const key = createHash("sha1").update(workspacePath).digest("hex").slice(0, 16);
  return path.join(dir, `lasttest-${key}.json`);
}

function loadLastTestTotal() {
  try {
    const saved = JSON.parse(readFileSync(lastTestTotalFile(), "utf8"));
    return Number(saved.total) || 0;
  } catch {
    return 0;
  }
}

function persistLastTestTotal(total) {
  if (!total || total < 1) return;
  try {
    const { dir } = settingsPaths();
    mkdirSync(dir, { recursive: true });
    writeFileSync(lastTestTotalFile(), JSON.stringify({ total }, null, 2));
  } catch (e) {
    session.log(`[coffilot] failed to persist last test total: ${e.message}`, { level: "warn" });
  }
}

const settings = loadSettings();
// Estimate for the progress bar: persisted full-reactor total from the last
// foreground Test run.
let lastTestTotal = loadLastTestTotal();

// the UI can offer a dropdown instead of a free-text module box. Each module is
// tagged with the capabilities detectable from its own pom: "runnable" (applies
// spring-boot-maven-plugin, so it can be launched with spring-boot:run),
// springBoot, actuator, and bootui. These drive graceful UI degradation.
let projectModules = null;

// Per-pom capability flags, derived purely from the pom text (cheap + offline).
function pomCaps(xml, name) {
  return {
    name,
    runnable: xml.includes("spring-boot-maven-plugin"),
    springBoot: xml.includes("spring-boot-maven-plugin") || xml.includes("org.springframework.boot"),
    actuator: xml.includes("spring-boot-starter-actuator"),
    devtools: xml.includes("spring-boot-devtools"),
    bootui: /bootui-spring-boot-starter|julien-dubois\.bootui|jdubois\.bootui/.test(xml),
  };
}

// The project's own artifactId (skip the <parent> block so we don't read the
// parent/BOM artifactId by mistake). Used as a display label for the root module.
function artifactIdOf(xml) {
  const noParent = xml.replace(/<parent>[\s\S]*?<\/parent>/, "");
  const m = noParent.match(/<artifactId>\s*([^<]+?)\s*<\/artifactId>/);
  return m ? m[1] : null;
}

function listModules() {
  if (projectModules) return projectModules;
  const out = [];
  const seen = new Set();
  const visited = new Set();
  const visit = (dir, rel) => {
    if (visited.has(dir)) return;
    visited.add(dir);
    const pom = path.join(dir, "pom.xml");
    let xml;
    try {
      xml = readFileSync(pom, "utf8");
    } catch {
      return;
    }
    if (rel && !seen.has(rel)) {
      seen.add(rel);
      out.push(pomCaps(xml, rel));
    }
    const modulesBlock = (xml.match(/<modules>([\s\S]*?)<\/modules>/) || [, ""])[1];
    // Fresh, non-stateful matching each call so recursion can't corrupt lastIndex.
    const children = [...modulesBlock.matchAll(/<module>\s*([^<]+?)\s*<\/module>/g)].map((m) => m[1]);
    for (const child of children) {
      const childRel = rel ? `${rel}/${child}` : child;
      visit(path.join(dir, child), childRel);
    }
  };
  try {
    visit(workspacePath, "");
  } catch {
    /* ignore */
  }
  // Single-module project (no <modules>): represent the root pom itself so the
  // canvas still works on a standalone app. name="" means "no -pl" everywhere.
  if (!out.length) {
    try {
      const xml = readFileSync(path.join(workspacePath, "pom.xml"), "utf8");
      const root = pomCaps(xml, "");
      root.artifactId = artifactIdOf(xml) || "app";
      out.push(root);
    } catch {
      /* ignore */
    }
  }
  projectModules = out;
  return projectModules;
}

// Best-effort Java version from the root pom's common properties.
let javaVersion = undefined;
function detectJavaVersion() {
  if (javaVersion !== undefined) return javaVersion;
  javaVersion = null;
  try {
    const xml = readFileSync(path.join(workspacePath, "pom.xml"), "utf8");
    for (const re of [
      /<java\.version>\s*([^<]+?)\s*<\/java\.version>/,
      /<maven\.compiler\.release>\s*([^<]+?)\s*<\/maven\.compiler\.release>/,
      /<maven\.compiler\.target>\s*([^<]+?)\s*<\/maven\.compiler\.target>/,
    ]) {
      const m = xml.match(re);
      if (m) {
        javaVersion = m[1];
        break;
      }
    }
  } catch {
    /* ignore */
  }
  return javaVersion;
}

// Static capability tiers, derived from the poms. The runtime metrics tier
// (refreshMetrics) is authoritative once the app is up; these are the hints the
// UI uses before/while running to decide what controls to show.
function capabilitiesSnapshot() {
  const mods = listModules();
  return {
    maven: existsSync(mvnw) || detectMvn().available,
    java: detectJavaVersion(),
    springBoot: mods.some((m) => m.springBoot),
    runnable: mods.some((m) => m.runnable),
    actuator: mods.some((m) => m.actuator),
    devtools: mods.some((m) => m.devtools),
    bootui: mods.some((m) => m.bootui),
  };
}

// Maven build profiles declared across the reactor poms (<profiles><profile><id>).
// Scoped to the <profiles> block so we don't pick up unrelated <id> elements
// (executions, repositories, etc.). Cached and exposed so the UI can offer a
// datalist instead of a free-text box.
let mavenProfiles = null;
function listMavenProfiles() {
  if (mavenProfiles) return mavenProfiles;
  const ids = new Set();
  const dirs = [workspacePath, ...listModules().map((m) => path.join(workspacePath, m.name))];
  for (const dir of dirs) {
    let xml;
    try {
      xml = readFileSync(path.join(dir, "pom.xml"), "utf8");
    } catch {
      continue;
    }
    // Greedy to span the whole top-level <profiles> section even when a profile
    // contains a nested plugin-config <profiles> block (e.g. spring-boot:run).
    const block = (xml.match(/<profiles>([\s\S]*)<\/profiles>/) || [, ""])[1];
    for (const p of block.matchAll(/<profile>([\s\S]*?)<\/profile>/g)) {
      const id = (p[1].match(/<id>\s*([^<]+?)\s*<\/id>/) || [])[1];
      if (id) ids.add(id);
    }
  }
  mavenProfiles = [...ids].sort();
  return mavenProfiles;
}

// Spring Boot profiles discoverable from the classic file-name convention
// (application-<profile>.properties|yml|yaml) under each module's resources.
// This covers the common case; profiles activated only via
// spring.config.activate.on-profile inside a multi-doc file are not listed.
let springProfiles = null;
const SPRING_PROFILE_RE = /^application-([A-Za-z0-9_-]+)\.(?:properties|ya?ml)$/;
function listSpringProfiles() {
  if (springProfiles) return springProfiles;
  const names = new Set();
  const dirs = [workspacePath, ...listModules().map((m) => path.join(workspacePath, m.name))];
  for (const dir of dirs) {
    for (const sub of ["src/main/resources", "src/main/resources/config"]) {
      let entries;
      try {
        entries = readdirSync(path.join(dir, sub));
      } catch {
        continue;
      }
      for (const f of entries) {
        const m = SPRING_PROFILE_RE.exec(f);
        if (m) names.add(m[1]);
      }
    }
  }
  springProfiles = [...names].sort();
  return springProfiles;
}

// ---------------------------------------------------------------------------
// Runner state (workspace-global: one app run at a time, like a dev inner loop)
// ---------------------------------------------------------------------------

const CONSOLE_CAP = 800;

// Two execution lanes that can run concurrently:
//   • Build and Test SHARE a single Maven process lane — serialized with each
//     other (one mvn child at a time) but independent of the app.
//   • Run is a fully independent, long-lived lane (the app itself), so the app
//     can stay up while a build or test runs.
// Each op keeps its own phase/command/console so the UI can show a status header
// and a console per Build/Test/Run tab.
function newLane(op) {
  return {
    op,
    phase: "idle", // idle | building | testing | running | stopped | failed
    command: "",
    runnerLabel: baseRunner().label,
    warm: false,
    exitCode: null,
    child: null, // the process this op currently owns (null when not running)
    console: [], // { line, stream, op }
  };
}

const lanes = {
  build: newLane("build"),
  test: newLane("test"),
  package: newLane("package"),
  run: newLane("run"),
};

// Run-lane application state (only meaningful while the app is up).
const app = {
  runMode: null, // spring | java — how the app was launched (for run failures)
  appPort: null,
  appUp: false,
  appReachedUp: false, // app served a metrics endpoint at least once this run
  module: null, // module selected for the current run (for live reload)
  mavenProfiles: null, // Maven profiles used for the current run (for live reload)
};

// Latest unit-test results (from a foreground Test run).
let lastTest = null; // summary { tests, failures, errors, skipped }
let lastTestReport = null; // full { summary, suites: [{ name, cases: [...] }] }

// Build, Test and Package share the Maven lane: at most one runs at a time.
function mvnLaneBusy() {
  return lanes.build.child !== null || lanes.test.child !== null || lanes.package.child !== null;
}
function runLaneBusy() {
  return lanes.run.child !== null;
}

let testRunStartedAt = 0;

// Live test progress, parsed from surefire's console output so the Tests tab
// fills in class-by-class during the run instead of only at the end.
let testProgress = null;

// ---------------------------------------------------------------------------
// Live reload (Spring Boot DevTools): while a Spring app runs, watch its
// sources and recompile on save. DevTools sees the refreshed target/classes on
// the classpath and restarts the app in place — the canvas plays the IDE's role
// of recompiling on save, so there's no editor/IDE required for the dev loop.
// ---------------------------------------------------------------------------

const SOURCE_RE = /\.(java|kt|kts|groovy|scala|properties|ya?ml|xml|html?|sql|js|mjs|ts|css|ftl|ftlh|mustache)$/i;

let liveReload = null; // active watcher handle while a Spring app runs
let reloadCtx = null; // { module, mavenProfiles, bin, label }
let reloadBusy = false;
let reloadPending = false;
let reloadDebounce = null;

function liveReloadStatus() {
  return { active: !!liveReload, enabled: settings.devtools, busy: reloadBusy };
}

// Recursive directory watcher with no native deps. fs.watch's { recursive }
// isn't supported on Linux, so we walk the tree and watch each directory,
// adding watchers for any subdirectory that appears later.
function watchTree(root, onChange) {
  const watchers = [];
  const watched = new Set();
  const add = (dir) => {
    if (watched.has(dir)) return;
    let w;
    try {
      w = fsWatch(dir, { persistent: false }, (_event, filename) => {
        if (filename) {
          const full = path.join(dir, filename);
          try {
            if (statSync(full).isDirectory()) add(full);
          } catch {
            /* deleted */
          }
        }
        onChange(filename ? path.join(dir, filename) : dir);
      });
    } catch {
      return;
    }
    watchers.push(w);
    watched.add(dir);
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      /* ignore */
    }
    for (const e of entries) if (e.isDirectory()) add(path.join(dir, e.name));
  };
  add(root);
  return {
    close() {
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          /* ignore */
        }
      }
    },
  };
}

function startLiveReload(ctx) {
  stopLiveReload();
  const root = path.join(workspacePath, ctx.module || "", "src", "main");
  if (!existsSync(root)) {
    pushConsole(
      `[live-reload] no ${path.relative(workspacePath, root) || "src/main"} to watch; live reload not started.`,
      "stderr",
      "run",
    );
    return;
  }
  reloadCtx = ctx;
  liveReload = watchTree(root, (file) => {
    if (!SOURCE_RE.test(file)) return;
    if (reloadDebounce) clearTimeout(reloadDebounce);
    reloadDebounce = setTimeout(triggerRecompile, 450);
  });
  pushConsole(
    `[live-reload] watching ${path.relative(workspacePath, root)} via ${ctx.label} — saving a source file recompiles so DevTools restarts the app.`,
    "stdout",
    "run",
  );
  broadcast("status", statusSnapshot());
}

function stopLiveReload() {
  if (reloadDebounce) {
    clearTimeout(reloadDebounce);
    reloadDebounce = null;
  }
  if (liveReload) {
    try {
      liveReload.close();
    } catch {
      /* ignore */
    }
    liveReload = null;
    reloadCtx = null;
    broadcast("status", statusSnapshot());
  }
}

function triggerRecompile() {
  if (!liveReload || !reloadCtx) return;
  if (reloadBusy) {
    reloadPending = true;
    return;
  }
  reloadBusy = true;
  const ctx = reloadCtx;
  pushConsole("[live-reload] change detected — recompiling…", "stdout", "run");
  broadcast("status", statusSnapshot());
  const args = ["-ntp", "-q", "-Dmaven.test.skip=true"];
  if (ctx.module) args.push("-pl", ctx.module);
  if (ctx.mavenProfiles && String(ctx.mavenProfiles).trim()) args.push("-P", String(ctx.mavenProfiles).trim());
  args.push("compile");
  let out = "";
  let child;
  try {
    child = spawn(ctx.bin, args, { cwd: workspacePath, env: mavenEnv(), shell: isWindows });
  } catch (e) {
    pushConsole(`[live-reload] recompile failed to start: ${e.message}`, "stderr", "run");
    return finishRecompile();
  }
  child.stdout.on("data", (c) => (out += c.toString()));
  child.stderr.on("data", (c) => (out += c.toString()));
  child.on("error", (e) => {
    pushConsole(`[live-reload] recompile failed to start: ${e.message}`, "stderr", "run");
    finishRecompile();
  });
  child.on("close", (code) => {
    if (code === 0) {
      pushConsole("[live-reload] recompiled — DevTools is restarting the app.", "stdout", "run");
    } else {
      pushConsole("[live-reload] compile failed; fix the error and save again:", "stderr", "run");
      const errs = out.split("\n").filter((l) => /\[ERROR\]|error:/i.test(l));
      for (const l of (errs.length ? errs : out.split("\n")).slice(-15)) if (l.trim()) pushConsole(l, "stderr", "run");
    }
    finishRecompile();
  });
}

function finishRecompile() {
  reloadBusy = false;
  broadcast("status", statusSnapshot());
  if (reloadPending) {
    reloadPending = false;
    triggerRecompile();
  }
}

// Start the live-reload watcher if DevTools is enabled and a Spring app with the
// DevTools dependency is currently running. Safe to call repeatedly.
function maybeStartLiveReload() {
  if (!settings.devtools) return;
  if (lanes.run.phase !== "running" || app.runMode !== "spring") return;
  if (reloadCtx) return; // already watching
  const mod = listModules().find((m) => m.name === (app.module || ""));
  if (mod && mod.devtools) {
    const r = resolveRunner(true);
    startLiveReload({ module: app.module || "", mavenProfiles: app.mavenProfiles, bin: r.bin, label: r.label });
  }
}

// Merge incoming settings, persist, and react to changes (live reload). Returns
// the saved snapshot.
function applySettings(body) {
  const prev = { ...settings };
  if (typeof body.warm === "boolean") settings.warm = body.warm;
  if (typeof body.springProfiles === "string") settings.springProfiles = body.springProfiles;
  if (typeof body.devtools === "boolean") settings.devtools = body.devtools;
  if (typeof body.randomPort === "boolean") settings.randomPort = body.randomPort;
  if (typeof body.openBrowser === "boolean") settings.openBrowser = body.openBrowser;
  persistSettings();

  if (settings.devtools !== prev.devtools) {
    if (settings.devtools) maybeStartLiveReload();
    else stopLiveReload();
  }

  broadcast("status", statusSnapshot());
  return settingsSnapshot();
}

let metricsTimer = null;
let lastMetrics = { appUp: false };

// ---------------------------------------------------------------------------
// Canvas instances (panels) + SSE clients
// ---------------------------------------------------------------------------

const instances = new Map(); // instanceId -> { token }
const sseClients = new Map(); // instanceId -> Set<res>

function instanceFor(instanceId) {
  let inst = instances.get(instanceId);
  if (!inst) {
    inst = { token: randomBytes(16).toString("hex") };
    instances.set(instanceId, inst);
  }
  return inst;
}

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const clients of sseClients.values()) {
    for (const res of clients) res.write(payload);
  }
}

function fixInfo(op) {
  const lane = lanes[op];
  if (op === "build" && lane.phase === "failed") {
    return { kind: "compile", label: "Fix build error with Copilot" };
  }
  if (op === "package" && lane.phase === "failed") {
    return { kind: "package", label: "Fix package error with Copilot" };
  }
  if (op === "test" && lastTestReport) {
    const s = lastTestReport.summary;
    if ((s.failures || 0) + (s.errors || 0) > 0) {
      return { kind: "test", label: "Fix failing tests with Copilot" };
    }
  }
  if (op === "run" && lane.phase === "failed") {
    return app.runMode === "java"
      ? { kind: "run-java", label: "Fix startup failure with Copilot" }
      : { kind: "run-spring", label: "Fix Spring Boot startup with Copilot" };
  }
  return null;
}

// Per-op status for one lane. Build and Test can't both be "running" (they share
// the Maven lane); Run is independent. The UI shows the active tab's lane in the
// header but keeps all three so it can re-render on tab switch.
function laneStatus(op) {
  const lane = lanes[op];
  const s = {
    op,
    phase: lane.phase,
    command: lane.command,
    runnerLabel: lane.runnerLabel,
    warm: lane.warm,
    exitCode: lane.exitCode,
    busy: lane.child !== null,
    fix: fixInfo(op),
  };
  if (op === "run") {
    s.runMode = app.runMode;
    s.appPort = app.appPort;
    s.appUp = app.appUp;
  }
  if (op === "test") s.lastTest = lastTest;
  return s;
}

function statusSnapshot() {
  return {
    build: laneStatus("build"),
    test: laneStatus("test"),
    package: laneStatus("package"),
    run: laneStatus("run"),
    metricsTier: lastMetrics.metricsTier || null,
    reload: liveReloadStatus(),
  };
}

/** Capabilities the UI uses to enable/explain the "Keep JVM warm" toggle. */
function envSnapshot() {
  const m = detectMvnd();
  return {
    mvndAvailable: m.available,
    mvndPath: m.path,
    modules: listModules(),
    mavenProfiles: listMavenProfiles(),
    springProfiles: listSpringProfiles(),
    capabilities: capabilitiesSnapshot(),
    settings: settingsSnapshot(),
    install: mvndInstallHint(),
  };
}

function pushConsole(line, stream, op = "build") {
  // op tags which tab's console (build | test | run) the line belongs to so the
  // UI can keep three separate consoles. Each lane owns its own buffer.
  const o = lanes[op] ? op : "build";
  const entry = { line, stream, op: o };
  const buf = lanes[o].console;
  buf.push(entry);
  if (buf.length > CONSOLE_CAP) buf.shift();
  broadcast("console", entry);
}

// ---------------------------------------------------------------------------
// Maven runner
// ---------------------------------------------------------------------------

/**
 * Spawn the Maven binary for one op's lane, stream output into that lane's
 * console, and resolve with the exit code. `op` is "build" | "test" | "run".
 */
function spawnMaven(op, args, phase, { onLine, bin, label } = {}) {
  const lane = lanes[op];
  const base = baseRunner();
  const mavenBin = bin || base.bin;
  const mavenLabel = label || base.label;
  return new Promise((resolve) => {
    lane.phase = phase;
    lane.runnerLabel = mavenLabel;
    lane.command = `${mavenLabel} ${args.join(" ")}`;
    lane.exitCode = null;
    broadcast("reset", { op });
    lane.console = [];
    broadcast("status", statusSnapshot());
    session.log(`[coffilot] ${lane.command}`, { level: "info", ephemeral: true });

    const child = spawn(mavenBin, args, {
      cwd: workspacePath,
      env: mavenEnv(),
      // mvnw.cmd / mvnd.cmd are batch scripts; modern Node refuses to spawn
      // .cmd/.bat directly, so route through the shell on Windows.
      shell: isWindows,
    });
    lane.child = child;

    const wire = (stream, name) => {
      let buf = "";
      stream.on("data", (chunk) => {
        buf += chunk.toString();
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).replace(/\r$/, "");
          buf = buf.slice(nl + 1);
          pushConsole(line, name, op);
          if (onLine) onLine(line);
        }
      });
      stream.on("end", () => {
        if (buf.length) {
          pushConsole(buf.replace(/\r$/, ""), name, op);
          if (onLine) onLine(buf);
        }
      });
    };
    wire(child.stdout, "stdout");
    wire(child.stderr, "stderr");

    child.on("error", (err) => {
      pushConsole(`[coffilot] failed to start Maven: ${err.message}`, "stderr", op);
      lane.child = null;
      lane.phase = "failed";
      lane.exitCode = -1;
      broadcast("status", statusSnapshot());
      resolve(-1);
    });

    child.on("close", (code) => {
      lane.child = null;
      lane.exitCode = code;
      if (phase === "running") {
        app.appUp = false;
        stopMetricsPolling();
        stopLiveReload();
        broadcast("metrics", lastMetrics);
        // A run that exits non-zero before the app ever served metrics is a
        // startup crash (surface a Fix button); otherwise it was a clean stop.
        lane.phase = code === 0 || app.appReachedUp ? "stopped" : "failed";
      } else {
        lane.phase = code === 0 ? "idle" : "failed";
      }
      broadcast("status", statusSnapshot());
      resolve(code);
    });
  });
}

function tail(op = "build", n = 25) {
  return lanes[op].console.slice(-n).map((e) => e.line);
}

// Pick the lane an agent status check most likely cares about: a failed lane
// first, then a busy one, else build.
function mostRelevantOp() {
  for (const o of ["build", "test", "package", "run"]) if (lanes[o].phase === "failed") return o;
  for (const o of ["run", "test", "package", "build"]) if (lanes[o].child) return o;
  return "build";
}

// ---------------------------------------------------------------------------
// Live test progress (parsed from surefire console output)
// ---------------------------------------------------------------------------

// "[INFO] Running com.example.FooTest"
const SUREFIRE_RUNNING_RE = /(?:^|\s)Running (\S+\.\S+)\s*$/;
// "[INFO] Tests run: 5, Failures: 0, Errors: 0, Skipped: 1, Time elapsed: 0.31 s -- in com.example.FooTest"
const SUREFIRE_PER_CLASS_RE =
  /Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)(?:, Time elapsed: ([\d.,]+)\s*s)?.*?-- in (\S+)/;

function resetTestProgress(estimateTotal = 0) {
  // estimateTotal is the previous run's total test count, used to drive a
  // determinate progress bar (surefire doesn't announce the total up front).
  testProgress = { running: true, current: null, suites: [], byName: new Map(), estimateTotal };
}

function liveTestSummary(p) {
  const sum = { tests: 0, passed: 0, failures: 0, errors: 0, skipped: 0, timeSec: 0 };
  for (const s of p.suites) {
    if (s.status === "running") continue;
    sum.tests += s.tests;
    sum.failures += s.failures;
    sum.errors += s.errors;
    sum.skipped += s.skipped;
    sum.timeSec += s.timeSec;
  }
  sum.passed = Math.max(0, sum.tests - sum.failures - sum.errors - sum.skipped);
  sum.timeSec = Math.round(sum.timeSec * 1000) / 1000;
  return sum;
}

function broadcastTestProgress() {
  if (!testProgress) return;
  broadcast("test-progress", {
    running: testProgress.running,
    current: testProgress.current,
    estimateTotal: testProgress.estimateTotal || 0,
    suites: testProgress.suites.map((s) => ({
      name: s.name,
      status: s.status,
      tests: s.tests,
      failures: s.failures,
      errors: s.errors,
      skipped: s.skipped,
      timeSec: s.timeSec,
    })),
    summary: liveTestSummary(testProgress),
  });
}

/** Parse one console line for surefire test progress and broadcast updates. */
function onTestLine(line) {
  if (!testProgress) return;
  let m = line.match(SUREFIRE_RUNNING_RE);
  if (m) {
    const name = m[1];
    let suite = testProgress.byName.get(name);
    if (!suite) {
      suite = { name, status: "running", tests: 0, failures: 0, errors: 0, skipped: 0, timeSec: 0 };
      testProgress.byName.set(name, suite);
      testProgress.suites.push(suite);
    } else {
      suite.status = "running";
    }
    testProgress.current = name;
    broadcastTestProgress();
    return;
  }
  m = line.match(SUREFIRE_PER_CLASS_RE);
  if (m) {
    const name = m[6];
    const tests = Number(m[1]) || 0;
    const failures = Number(m[2]) || 0;
    const errors = Number(m[3]) || 0;
    const skipped = Number(m[4]) || 0;
    const timeSec = m[5] ? Number(String(m[5]).replace(",", ".")) || 0 : 0;
    let suite = testProgress.byName.get(name);
    if (!suite) {
      suite = { name };
      testProgress.byName.set(name, suite);
      testProgress.suites.push(suite);
    }
    suite.tests = tests;
    suite.failures = failures;
    suite.errors = errors;
    suite.skipped = skipped;
    suite.timeSec = timeSec;
    suite.status = failures + errors > 0 ? "fail" : tests > 0 && skipped >= tests ? "skipped" : "pass";
    if (testProgress.current === name) testProgress.current = null;
    broadcastTestProgress();
  }
}

function withMavenProfiles(args, mavenProfiles) {
  const p = mavenProfiles && String(mavenProfiles).trim();
  return p ? [...args, "-P", p] : args;
}

async function build(extraArgs, warm, mavenProfiles) {
  if (mvnLaneBusy()) return { ok: false, error: "A build, test or package is already running. Stop it first." };
  const base = extraArgs && extraArgs.length ? extraArgs : ["-ntp", "-DskipTests", "install"];
  const args = withMavenProfiles(base, mavenProfiles);
  const r = resolveRunner(warm);
  lanes.build.warm = r.warm;
  const code = await spawnMaven("build", args, "building", { bin: r.bin, label: r.label });
  return {
    ok: code === 0,
    exitCode: code,
    command: lanes.build.command,
    runner: r.label,
    warm: r.warm,
    tail: tail("build"),
  };
}

async function packageApp(extraArgs, warm, mavenProfiles) {
  if (mvnLaneBusy()) return { ok: false, error: "A build, test or package is already running. Stop it first." };
  const base = extraArgs && extraArgs.length ? extraArgs : ["-ntp", "package"];
  const args = withMavenProfiles(base, mavenProfiles);
  const r = resolveRunner(warm);
  lanes.package.warm = r.warm;
  const code = await spawnMaven("package", args, "packaging", { bin: r.bin, label: r.label });
  return {
    ok: code === 0,
    exitCode: code,
    command: lanes.package.command,
    runner: r.label,
    warm: r.warm,
    tail: tail("package"),
  };
}

async function test(extraArgs, warm, mavenProfiles) {
  if (mvnLaneBusy()) return { ok: false, error: "A build, test or package is already running. Stop it first." };
  const base = extraArgs && extraArgs.length ? extraArgs : ["-ntp", "test"];
  const args = withMavenProfiles(base, mavenProfiles);
  const r = resolveRunner(warm);
  lanes.test.warm = r.warm;
  lastTestReport = null;
  broadcast("tests", null);
  // Seed the progress-bar estimate: persisted total if we have one, otherwise
  // the total from any surefire reports already on disk (a prior run), so the
  // bar is determinate from the first run instead of an indeterminate sweep.
  let estimate = lastTestTotal;
  if (!estimate) {
    try {
      const prev = await collectSurefireReport(0);
      estimate = (prev.summary && prev.summary.tests) || 0;
    } catch {
      estimate = 0;
    }
  }
  resetTestProgress(estimate);
  testRunStartedAt = Date.now();
  const code = await spawnMaven("test", args, "testing", { bin: r.bin, label: r.label, onLine: onTestLine });
  if (testProgress) {
    testProgress.running = false;
    broadcastTestProgress();
  }
  const report = await collectSurefireReport(testRunStartedAt);
  lastTestReport = report;
  lastTest = report.summary;
  // Persist the total only when Maven exited on its own (code is a number).
  // A manual Stop kills the process (code === null), which would otherwise
  // persist a partial total and skew the next run's bar.
  if (code !== null && report.summary && report.summary.tests > 0) {
    lastTestTotal = report.summary.tests;
    persistLastTestTotal(lastTestTotal);
  }
  broadcast("tests", report);
  broadcast("status", statusSnapshot());
  return {
    ok: code === 0,
    exitCode: code,
    command: lanes.test.command,
    runner: r.label,
    warm: r.warm,
    report: trimReportForAgent(report),
    tail: tail("test"),
  };
}

async function startApp({ module, profiles, mavenProfiles, mode } = {}) {
  if (runLaneBusy()) return { ok: false, error: "The app is already running. Stop it first." };
  lanes.run.warm = false;
  app.appPort = null;
  app.appUp = false;
  app.appReachedUp = false;
  csrfToken = null;
  lastMetrics = { appUp: false };

  // Pick the run strategy: explicit mode wins, else infer from whether the
  // chosen module applies the spring-boot-maven-plugin.
  const mod = listModules().find((m) => m.name === module);
  const resolved = mode === "java" || mode === "spring" ? mode : mod && mod.runnable ? "spring" : "java";
  app.runMode = resolved;
  app.module = module || "";
  app.mavenProfiles = mavenProfiles || null;

  if (resolved === "spring") {
    // The app is long-lived, so it always runs via the wrapper/mvn (mvnd is for builds).
    const args = ["-ntp"];
    if (module) args.push("-pl", module);
    if (mavenProfiles && mavenProfiles.trim()) args.push("-P", mavenProfiles.trim());
    args.push("-Dmaven.test.skip=true", "spring-boot:run");
    if (profiles) args.push(`-Dspring-boot.run.profiles=${profiles}`);
    // Pass the native-access flag to the forked app JVM so its FFM-using
    // dependencies don't print restricted-method warnings.
    args.push(`-Dspring-boot.run.jvmArguments=${NATIVE_ACCESS_FLAG}`);
    // "Use a random HTTP port": run on a free port the console picks (via
    // server.port) so the app doesn't collide with whatever owns the default.
    if (settings.randomPort) {
      let port = 0;
      try {
        port = await freePort();
      } catch {
        /* fall back to server.port=0 (Spring picks one; detectPort reads it) */
      }
      args.push(`-Dspring-boot.run.arguments=--server.port=${port}`);
      pushConsole(`[coffilot] using HTTP port ${port || "(random)"} via server.port.`, "stdout", "run");
    }
    spawnMaven("run", args, "running", { onLine: detectPort }); // fire-and-forget
    // DevTools restarts in place when target/classes changes, so watch sources
    // and recompile on save to drive that loop automatically.
    if (settings.devtools && mod && mod.devtools) {
      const r = resolveRunner(true);
      startLiveReload({ module: module || "", mavenProfiles, bin: r.bin, label: r.label });
    }
    return { ok: true, started: true, mode: "spring", command: `${baseRunner().label} ${args.join(" ")}` };
  }

  // Pure-Java: package the module, then launch its jar with `java -jar`.
  runPureJava({ module, mavenProfiles });
  return { ok: true, started: true, mode: "java" };
}

/** Two-phase pure-Java launch: mvn package (compile gate) then java -jar.
 * Both phases run on the independent Run lane so launching the app never blocks
 * (or is blocked by) a Build/Test on the shared Maven lane. */
async function runPureJava({ module, mavenProfiles }) {
  app.runMode = "java";
  const pkg = ["-ntp", "-Dmaven.test.skip=true"];
  if (module) pkg.push("-pl", module);
  if (mavenProfiles && mavenProfiles.trim()) pkg.push("-P", mavenProfiles.trim());
  pkg.push("package");
  const code = await spawnMaven("run", pkg, "building", {});
  if (code !== 0) return; // run lane already 'failed' -> "fix startup" path

  const jar = await findRunnableJar(module);
  if (!jar) {
    pushConsole("[coffilot] no runnable .jar found under target/ for this module.", "stderr", "run");
    lanes.run.phase = "failed";
    lanes.run.exitCode = -1;
    broadcast("status", statusSnapshot());
    return;
  }
  spawnMaven("run", [NATIVE_ACCESS_FLAG, "-jar", jar], "running", { bin: "java", label: "java", onLine: detectPort });
}

/** Best-effort pick of a module's main artifact jar (skip sources/javadoc). */
async function findRunnableJar(module) {
  const dir = path.join(workspacePath, module || "", "target");
  let files;
  try {
    files = await readdir(dir);
  } catch {
    return null;
  }
  const jars = files.filter((f) => f.endsWith(".jar") && !f.endsWith("-sources.jar") && !f.endsWith("-javadoc.jar"));
  if (!jars.length) return null;
  // The shortest name is the main artifact (classifier-less) in most layouts.
  jars.sort((a, b) => a.length - b.length);
  return path.join(dir, jars[0]);
}

/** SIGTERM (then SIGKILL) a child process tree, cross-platform. */
function killChild(child) {
  if (!child) return;
  if (isWindows && child.pid) {
    // shell:true means child is cmd.exe; kill the whole tree by PID so the
    // spawned Maven/Java processes don't get orphaned.
    try {
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
    } catch {
      /* ignore */
    }
  } else {
    child.kill("SIGTERM");
    // Escalate if it ignores SIGTERM.
    setTimeout(() => {
      if (child && !child.killed) {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }
    }, 5000);
  }
}

/**
 * Stop one lane's process, the whole Maven group (op="maven" → build/test/
 * package), or all of them when `op` is omitted. The Run lane also tears down
 * metrics polling and live reload; the Maven lanes just kill the shared child.
 * Lanes are independent, so stopping the Maven group leaves Run running.
 */
function stopApp(op) {
  let targets;
  if (op === "maven") targets = ["build", "test", "package"];
  else if (op && lanes[op]) targets = [op];
  else targets = ["build", "test", "package", "run"];
  let stopped = false;
  for (const o of targets) {
    if (o === "run") {
      stopMetricsPolling();
      stopLiveReload();
    }
    const child = lanes[o].child;
    if (child) {
      killChild(child);
      stopped = true;
    }
  }
  return stopped ? { ok: true, stopped: true } : { ok: true, stopped: false, note: "Nothing was running." };
}

const PORT_PATTERNS = [
  /Tomcat (?:started|initialized).*?port[s]?(?:\(s\))?:?\s*(\d+)/i,
  /Netty started on port[s]?(?:\(s\))?:?\s*(\d+)/i,
  /Undertow.*?port[s]?(?:\(s\))?:?\s*(\d+)/i,
  /started on port[s]?(?:\(s\))?:?\s*(\d+)/i,
];

function detectPort(line) {
  if (app.appPort) return;
  // DevTools' LiveReload server logs its own port (35729); never treat that as
  // the application's HTTP port.
  if (/LiveReload/i.test(line)) return;
  for (const re of PORT_PATTERNS) {
    const m = line.match(re);
    if (m) {
      app.appPort = Number(m[1]);
      pushConsole(`[coffilot] detected app port ${app.appPort}; polling /bootui/api`, "stdout", "run");
      broadcast("status", statusSnapshot());
      startMetricsPolling();
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Surefire report parsing (no XML dependency: scan testsuite/testcase elements)
// ---------------------------------------------------------------------------

function decodeXml(s) {
  return (s || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#10;/g, "\n")
    .replace(/&#9;/g, "\t")
    .replace(/&#13;/g, "\r")
    .replace(/&amp;/g, "&");
}

function xmlAttr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? decodeXml(m[1]) : null;
}

/**
 * Parse every surefire TEST-*.xml into a structured report with per-method
 * results. {@code sinceMs} filters out stale reports left by earlier builds of
 * other modules so only the freshly-run module's results are reported.
 */
async function collectSurefireReport(sinceMs) {
  const report = {
    summary: { tests: 0, passed: 0, failures: 0, errors: 0, skipped: 0, timeSec: 0, files: 0 },
    suites: [],
  };
  const dirs = await findSurefireDirs(workspacePath, 0);
  for (const dir of dirs) {
    let files;
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.startsWith("TEST-") || !f.endsWith(".xml")) continue;
      const full = path.join(dir, f);
      if (sinceMs) {
        try {
          const st = await stat(full);
          if (st.mtimeMs < sinceMs - 3000) continue;
        } catch {
          continue;
        }
      }
      let xml;
      try {
        xml = await readFile(full, "utf8");
      } catch {
        continue;
      }
      const suiteTag = (xml.match(/<testsuite\b[^>]*>/) || [""])[0];
      const suite = {
        name: xmlAttr(suiteTag, "name") || f.replace(/^TEST-/, "").replace(/\.xml$/, ""),
        tests: Number(xmlAttr(suiteTag, "tests")) || 0,
        failures: Number(xmlAttr(suiteTag, "failures")) || 0,
        errors: Number(xmlAttr(suiteTag, "errors")) || 0,
        skipped: Number(xmlAttr(suiteTag, "skipped")) || 0,
        timeSec: Number(xmlAttr(suiteTag, "time")) || 0,
        cases: [],
      };
      const caseRe = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
      let m;
      while ((m = caseRe.exec(xml)) !== null) {
        const openAttrs = m[1] || "";
        const inner = m[2] || "";
        const fail = inner.match(/<(failure|error|skipped)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/);
        let status = "passed";
        let message = null;
        let type = null;
        let detail = null;
        if (fail) {
          status = fail[1] === "skipped" ? "skipped" : fail[1] === "error" ? "error" : "failed";
          message = xmlAttr(fail[2] || "", "message");
          type = xmlAttr(fail[2] || "", "type");
          detail = fail[3] ? decodeXml(fail[3]).trim() : null;
        }
        suite.cases.push({
          name: xmlAttr(openAttrs, "name") || "(unknown)",
          classname: xmlAttr(openAttrs, "classname"),
          timeSec: Number(xmlAttr(openAttrs, "time")) || 0,
          status,
          message,
          type,
          detail,
        });
      }
      report.suites.push(suite);
      report.summary.tests += suite.tests || suite.cases.length;
      report.summary.failures += suite.failures;
      report.summary.errors += suite.errors;
      report.summary.skipped += suite.skipped;
      report.summary.timeSec += suite.timeSec;
      report.summary.files += 1;
    }
  }
  report.summary.passed = Math.max(
    0,
    report.summary.tests - report.summary.failures - report.summary.errors - report.summary.skipped,
  );
  report.summary.timeSec = Math.round(report.summary.timeSec * 1000) / 1000;
  // Surface failing suites first.
  report.suites.sort((a, b) => b.failures + b.errors - (a.failures + a.errors) || a.name.localeCompare(b.name));
  return report;
}

/** Compact a full report for an agent action result (failures + per-suite counts only). */
function trimReportForAgent(report) {
  if (!report) return null;
  return {
    summary: report.summary,
    failures: report.suites.flatMap((s) =>
      s.cases
        .filter((c) => c.status === "failed" || c.status === "error")
        .map((c) => ({
          suite: s.name,
          test: c.name,
          status: c.status,
          message: c.message,
          detail: c.detail ? c.detail.split("\n").slice(0, 12).join("\n") : null,
        })),
    ),
    suites: report.suites.map((s) => ({
      name: s.name,
      tests: s.tests,
      failures: s.failures,
      errors: s.errors,
      skipped: s.skipped,
      timeSec: s.timeSec,
    })),
  };
}

const SKIP_DIRS = new Set(["node_modules", ".git", ".m2", "src", "frontend"]);

async function findSurefireDirs(root, depth, acc = []) {
  if (depth > 4) return acc;
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const full = path.join(root, e.name);
    if (e.name === "surefire-reports") {
      acc.push(full);
      continue;
    }
    if (SKIP_DIRS.has(e.name)) continue;
    await findSurefireDirs(full, depth + 1, acc);
  }
  return acc;
}

// ---------------------------------------------------------------------------
// Live metrics — reused straight from BootUI's REST API
// ---------------------------------------------------------------------------

function startMetricsPolling() {
  stopMetricsPolling();
  metricsTimer = setInterval(refreshMetrics, 2500);
  refreshMetrics();
}

function stopMetricsPolling() {
  if (metricsTimer) {
    clearInterval(metricsTimer);
    metricsTimer = null;
  }
}

async function fetchJson(base, p) {
  try {
    const res = await fetch(base + p, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Pull a single Micrometer actuator metric's VALUE measurement (or null). */
async function actuatorMetric(base, name, tag) {
  const q = tag ? `?tag=${encodeURIComponent(tag)}` : "";
  const json = await fetchJson(base, `/actuator/metrics/${name}${q}`);
  if (!json || !Array.isArray(json.measurements)) return null;
  const v = json.measurements.find((m) => m.statistic === "VALUE") || json.measurements[0];
  return v ? v.value : null;
}

/** Normalize Actuator endpoints into the same shape the BootUI tier produces. */
async function actuatorMetrics(base, health) {
  const [heapUsed, heapMax, nonHeapUsed, threadsLive, threadsDaemon, uptime] = await Promise.all([
    actuatorMetric(base, "jvm.memory.used", "area:heap"),
    actuatorMetric(base, "jvm.memory.max", "area:heap"),
    actuatorMetric(base, "jvm.memory.used", "area:nonheap"),
    actuatorMetric(base, "jvm.threads.live"),
    actuatorMetric(base, "jvm.threads.daemon"),
    actuatorMetric(base, "process.uptime"),
  ]);
  const info = await fetchJson(base, "/actuator/info");
  const usedPercent = heapUsed && heapMax ? Math.round((heapUsed / heapMax) * 100) : null;
  return {
    appUp: true,
    metricsTier: "actuator",
    overview: {
      applicationName: (info && (info.app?.name || info.build?.name)) || null,
      springBootVersion: null,
      javaVersion: null,
      activeProfiles: [],
      startupTimeMillis: uptime != null ? Math.round(uptime * 1000) : null,
    },
    memory: {
      heap: { usedBytes: heapUsed, maxBytes: heapMax, usedPercent },
      nonHeap: { usedBytes: nonHeapUsed },
    },
    health: health ? { status: health.status } : null,
    threads: threadsLive != null ? { totalThreads: threadsLive, daemonThreads: threadsDaemon ?? 0 } : null,
  };
}

async function refreshMetrics() {
  if (!app.appPort) return null;
  const base = `http://127.0.0.1:${app.appPort}`;

  // Tier 1 — BootUI: rich, sanitized DTOs straight from /bootui/api/**.
  const overview = await fetchJson(base, "/bootui/api/overview");
  if (overview) {
    const [memory, health, threads, mcp] = await Promise.all([
      fetchJson(base, "/bootui/api/live-memory"),
      fetchJson(base, "/bootui/api/health"),
      fetchJson(base, "/bootui/api/threads?limit=0"),
      fetchJson(base, "/bootui/api/mcp-server"),
    ]);
    lastMetrics = { appUp: true, metricsTier: "bootui", overview, memory, health, threads, mcp: normalizeMcp(mcp) };
    return finishMetrics();
  }

  // Tier 2 — Actuator: normalize /actuator/* into the same shape.
  const health = await fetchJson(base, "/actuator/health");
  if (health) {
    lastMetrics = await actuatorMetrics(base, health);
    return finishMetrics();
  }

  // Tier 3 — process only: the port is open but no diagnostics endpoint answered.
  lastMetrics = { appUp: true, metricsTier: "process" };
  return finishMetrics();
}

function finishMetrics() {
  if (lastMetrics.appUp && !app.appUp) {
    app.appUp = true;
    app.appReachedUp = true;
    // "Open browser when the app starts" (Run tab): fire once, when the app
    // first becomes reachable this run.
    if (settings.openBrowser) {
      const base = appBase();
      if (base) openExternalUrl(base);
    }
    broadcast("status", statusSnapshot());
  }
  broadcast("metrics", lastMetrics);
  return lastMetrics;
}

/** Shape the BootUI MCP server status for the UI (enabled + advertised tools). */
function normalizeMcp(mcp) {
  if (!mcp) return null;
  return {
    available: true,
    enabled: mcp.enabled === true || mcp.running === true,
    mode: mcp.mode || mcp.configuredMode || null,
    tools: Array.isArray(mcp.tools) ? mcp.tools : Array.isArray(mcp.advertisedTools) ? mcp.advertisedTools : [],
  };
}

// ---------------------------------------------------------------------------
// Bidirectional: push a context-rich "fix this" prompt back to the Copilot agent
// ---------------------------------------------------------------------------

function codeBlock(lines, lang = "") {
  const text = Array.isArray(lines) ? lines.join("\n") : String(lines);
  return "```" + lang + "\n" + text + "\n```";
}

/** Console lines that look like build/compiler/startup errors. */
function errorLines(op, max = 60) {
  const re =
    /\[ERROR\]|BUILD FAILURE|Caused by:|Exception|cannot find symbol|incompatible types|APPLICATION FAILED TO START|Error creating bean|Port \d+ was already in use|FAILED/;
  return lanes[op].console
    .map((e) => e.line)
    .filter((l) => re.test(l))
    .slice(-max);
}

// Map a fix kind to the lane whose console/command/exit code is relevant.
const FIX_OP = { compile: "build", package: "package", test: "test", "run-java": "run", "run-spring": "run" };

function buildFixPrompt(kind, extra = {}) {
  const op = FIX_OP[kind] || "build";
  const lane = lanes[op];
  const where = lane.command ? `Command: \`${lane.command}\` (exit ${lane.exitCode}).` : "";
  switch (kind) {
    case "compile":
    case "package":
      return [
        "The Maven build in this project failed to compile/package. Find the root cause and fix the code so the build passes.",
        where,
        "Build errors:",
        codeBlock(errorLines(op).length ? errorLines(op) : tail(op, 60)),
      ]
        .filter(Boolean)
        .join("\n\n");
    case "test": {
      const r = lastTestReport ? trimReportForAgent(lastTestReport) : null;
      const failures = r
        ? r.failures
            .map((f) => `- ${f.suite} › ${f.test} (${f.status}): ${f.message || ""}\n${f.detail || ""}`)
            .join("\n\n")
        : "(no parsed failures available)";
      return [
        "Unit tests failed in this project. Diagnose and fix them — prefer fixing the code under test; only change a test if it is genuinely wrong.",
        r ? `Summary: ${r.summary.tests} tests, ${r.summary.failures} failures, ${r.summary.errors} errors.` : "",
        "Failures:",
        codeBlock(failures),
      ]
        .filter(Boolean)
        .join("\n\n");
    }
    case "run-java":
      return [
        "The application failed to start as a plain Java process (`java -jar`). Diagnose the startup failure (missing Main-Class, classpath, uncaught exception, port already in use, etc.) and fix it.",
        where,
        "Recent output:",
        codeBlock(tail("run", 70)),
      ]
        .filter(Boolean)
        .join("\n\n");
    case "run-spring":
      return [
        "The Spring Boot application failed to start. Diagnose the startup failure (bean wiring, missing/invalid configuration, failed auto-configuration, port already in use, datasource, etc.) and fix it.",
        where,
        "Recent output:",
        codeBlock(tail("run", 90)),
      ]
        .filter(Boolean)
        .join("\n\n");
    case "mcp":
      return [
        `BootUI's ${extra.tool ? "`" + extra.tool + "`" : "advisor"} scan flagged issues on the running app. Review the findings below and fix the important ones in the codebase.`,
        "Scan results:",
        codeBlock(JSON.stringify(extra.result ?? {}, null, 2).slice(0, 12000), "json"),
      ]
        .filter(Boolean)
        .join("\n\n");
    case "install-bootui": {
      const moduleName = extra.module || "";
      const pomRel = moduleName ? `${moduleName}/pom.xml` : "pom.xml";
      return [
        "This is a Spring Boot application that does not yet depend on BootUI. Add the BootUI Spring Boot starter so its local developer console becomes available, scoped to a dev-only Maven profile.",
        `Edit \`${pomRel}\` and add a dependency on \`com.julien-dubois.bootui:bootui-spring-boot-starter\` inside a Maven profile with \`<id>dev</id>\`:`,
        [
          "- If a `<profile>` with `<id>dev</id>` already exists in that pom, add the dependency to its `<dependencies>` block (create the `<dependencies>` element if the profile doesn't have one). Don't duplicate it if it's already there.",
          "- If there is no `dev` profile, create one (merging into an existing `<profiles>` block if present) that contains the dependency.",
          "- Use the latest released version of `com.julien-dubois.bootui:bootui-spring-boot-starter` from Maven Central; pin a concrete version rather than a range.",
          "- Leave the `dev` profile inactive by default so production builds are unaffected — BootUI activates when building/running with `-Pdev`.",
        ].join("\n"),
        "When done, tell me the version you pinned and the command to launch with BootUI enabled (e.g. `./mvnw -Pdev spring-boot:run` with the Spring `dev` profile, then open http://localhost:8080/bootui).",
      ]
        .filter(Boolean)
        .join("\n\n");
    }
    case "install-devtools": {
      const moduleName = extra.module || "";
      const pomRel = moduleName ? `${moduleName}/pom.xml` : "pom.xml";
      const resDir = moduleName ? `${moduleName}/src/main/resources` : "src/main/resources";
      return [
        "This is a Spring Boot application that doesn't yet use Spring Boot DevTools. Add DevTools (scoped to a dev-only Maven profile) and turn on live reload so the app restarts automatically on code changes.",
        `1. Edit \`${pomRel}\` and add a dependency on \`org.springframework.boot:spring-boot-devtools\` inside the Maven profile with \`<id>dev</id>\` (mark it \`<optional>true</optional>\`):`,
        [
          "   - If a `<profile>` with `<id>dev</id>` already exists, add the dependency to its `<dependencies>` (create that element if missing). Don't duplicate it if it's already present.",
          "   - If there is no `dev` profile, create one (merging into an existing `<profiles>` block if present) containing the dependency.",
          "   - Pin a concrete version only if the project doesn't manage Spring Boot via a parent/BOM; otherwise omit the version so it inherits.",
        ].join("\n"),
        `2. In \`${resDir}/application-dev.properties\` (create it if it doesn't exist), enable live reload:`,
        codeBlock("spring.devtools.restart.enabled=true\nspring.devtools.livereload.enabled=true", "properties"),
        "Keep the `dev` profile inactive by default so production builds are unaffected. After editing, tell me to run with `-Pdev` and the Spring `dev` profile — the canvas then recompiles on save so DevTools restarts the app.",
      ]
        .filter(Boolean)
        .join("\n\n");
    }
    default:
      return null;
  }
}

async function sendFix(kind, extra) {
  const prompt = buildFixPrompt(kind, extra);
  if (!prompt) return { ok: false, error: `Unknown fix kind: ${kind}` };
  try {
    await session.send({ prompt });
    session.log(`[coffilot] asked the agent to fix: ${kind}`, { level: "info" });
    return { ok: true, sent: true, kind };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ---------------------------------------------------------------------------
// BootUI MCP server bridge (only meaningful while the app is up on the bootui tier)
// ---------------------------------------------------------------------------

function appBase() {
  return app.appPort ? `http://127.0.0.1:${app.appPort}` : null;
}

// BootUI's state-changing admin endpoints (e.g. the MCP toggle) are protected by
// Spring Security's SPA CSRF when Spring Security is on the host classpath: a GET
// seeds an XSRF-TOKEN cookie that must be echoed back as the X-XSRF-TOKEN header on
// writes. (The JSON-RPC /bootui/api/mcp transport itself is CSRF-exempt.) We mirror
// the SPA: read the token from a GET, then replay it on the POST.
let csrfToken = null;
async function ensureCsrf(base) {
  if (csrfToken) return csrfToken;
  try {
    const res = await fetch(base + "/bootui/api/mcp-server", { headers: { Accept: "application/json" } });
    const setCookie = res.headers.get("set-cookie") || "";
    const m = setCookie.match(/XSRF-TOKEN=([^;]+)/);
    if (m) csrfToken = decodeURIComponent(m[1]);
    await res.text().catch(() => null);
  } catch {
    // No token available; the POST will surface any resulting 403.
  }
  return csrfToken;
}

async function appPost(base, pathname, body) {
  const send = async () => {
    const headers = { "Content-Type": "application/json", Accept: "application/json" };
    if (csrfToken) {
      headers["X-XSRF-TOKEN"] = csrfToken;
      headers["Cookie"] = `XSRF-TOKEN=${encodeURIComponent(csrfToken)}`;
    }
    return fetch(base + pathname, { method: "POST", headers, body: JSON.stringify(body ?? {}) });
  };
  await ensureCsrf(base);
  let res = await send();
  if (res.status === 403) {
    // Token may be missing or rotated — refresh once and retry.
    csrfToken = null;
    await ensureCsrf(base);
    res = await send();
  }
  return res;
}

// Scan tools (…_scan) advertised by the MCP status endpoint, which lists them even
// while the server is disabled. Derived from a GET so no CSRF dance is needed.
function scansFromTools(tools) {
  return (Array.isArray(tools) ? tools : [])
    .filter((t) => t && t.action && /_scan$/.test(t.name))
    .map((t) => ({ name: t.name, description: t.description || "" }));
}

async function mcpStatus() {
  const base = appBase();
  if (!base) return { available: false };
  const raw = await fetchJson(base, "/bootui/api/mcp-server");
  const status = normalizeMcp(raw) || { available: false };
  if (status.available) status.scans = scansFromTools(status.tools);
  return status;
}

async function mcpToggle(enabled) {
  const base = appBase();
  if (!base) return { ok: false, error: "App is not running." };
  try {
    const res = await appPost(base, "/bootui/api/mcp-server/toggle", enabled === undefined ? {} : { enabled });
    await res.text().catch(() => null);
    return { ok: res.ok, status: await mcpStatus() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

let mcpRpcId = 0;
async function mcpRpc(method, params) {
  const base = appBase();
  if (!base) return { error: { message: "App is not running." } };
  try {
    // The MCP JSON-RPC transport is CSRF-exempt, but appPost adds the header
    // harmlessly if a token is already cached.
    const res = await appPost(base, "/bootui/api/mcp", {
      jsonrpc: "2.0",
      id: ++mcpRpcId,
      method,
      params: params || {},
    });
    return await res.json();
  } catch (e) {
    return { error: { message: e.message } };
  }
}

// Unwrap an MCP tools/call result: the payload is in result.content[].text, and
// scan tools return a JSON string there. Parse it so the UI/agent get structured data.
function unwrapMcpResult(result) {
  if (!result) return result;
  const parts = Array.isArray(result.content) ? result.content : null;
  if (parts) {
    const text = parts
      .filter((p) => p && (p.type === "text" || typeof p.text === "string"))
      .map((p) => p.text)
      .join("\n")
      .trim();
    if (text) {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
  }
  return result;
}

async function mcpScan(tool) {
  if (!tool) return { ok: false, error: "No scan tool specified." };
  const r = await mcpRpc("tools/call", { name: tool, arguments: {} });
  if (r && r.error) return { ok: false, error: r.error.message || String(r.error) };
  const isError = r && r.result && r.result.isError === true;
  const data = unwrapMcpResult(r && r.result);
  if (isError) return { ok: false, tool, error: typeof data === "string" ? data : JSON.stringify(data) };
  return { ok: true, tool, result: data };
}

// ---------------------------------------------------------------------------
// Loopback HTTP server (iframe assets + SSE + control + metrics proxy)
// ---------------------------------------------------------------------------

let indexHtml = null;
async function loadIndex() {
  if (indexHtml === null) {
    indexHtml = await readFile(path.join(__dirname, "public", "index.html"), "utf8");
  }
  return indexHtml;
}

// Static iframe assets that carry no secrets and are therefore served without the
// instance/token gate: the iframe loads them as subresources, which the browser
// requests without the query string the token check relies on.
const STATIC_ASSETS = {
  "/styles.css": { file: "styles.css", type: "text/css; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
};
const staticCache = new Map();
async function loadStatic(name) {
  if (!staticCache.has(name)) {
    staticCache.set(name, await readFile(path.join(__dirname, "public", name), "utf8"));
  }
  return staticCache.get(name);
}

function valid(url) {
  const instanceId = url.searchParams.get("instance");
  const token = url.searchParams.get("token");
  const inst = instances.get(instanceId);
  return inst && inst.token === token ? instanceId : null;
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function sendJson(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && STATIC_ASSETS[url.pathname]) {
    const asset = STATIC_ASSETS[url.pathname];
    res.writeHead(200, { "Content-Type": asset.type });
    res.end(await loadStatic(asset.file));
    return;
  }

  const instanceId = valid(url);
  if (!instanceId) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(await loadIndex());
    return;
  }

  if (req.method === "GET" && url.pathname === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    if (!sseClients.has(instanceId)) sseClients.set(instanceId, new Set());
    sseClients.get(instanceId).add(res);
    res.write(`event: status\ndata: ${JSON.stringify(statusSnapshot())}\n\n`);
    res.write(`event: metrics\ndata: ${JSON.stringify(lastMetrics)}\n\n`);
    res.write(`event: tests\ndata: ${JSON.stringify(lastTestReport)}\n\n`);
    req.on("close", () => sseClients.get(instanceId)?.delete(res));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    sendJson(res, 200, {
      status: statusSnapshot(),
      metrics: lastMetrics,
      // Concatenate all lane buffers; each entry is tagged with its op so the
      // UI replays it into the right console.
      console: [...lanes.build.console, ...lanes.test.console, ...lanes.package.console, ...lanes.run.console],
      tests: lastTestReport,
      env: envSnapshot(),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/env") {
    sendJson(res, 200, envSnapshot());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/metrics") {
    sendJson(res, 200, (await refreshMetrics()) || lastMetrics);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/build") {
    const body = await readBody(req);
    build(null, body.warm === true, body.mavenProfiles); // fire-and-forget; progress streams over SSE
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/test") {
    const body = await readBody(req);
    test(null, body.warm === true, body.mavenProfiles);
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/package") {
    const body = await readBody(req);
    packageApp(null, body.warm === true, body.mavenProfiles); // fire-and-forget; streams over SSE
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/run") {
    const body = await readBody(req);
    sendJson(
      res,
      200,
      await startApp({
        module: body.module,
        profiles: body.profiles,
        mavenProfiles: body.mavenProfiles,
        mode: body.mode,
      }),
    );
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/stop") {
    const body = await readBody(req);
    sendJson(res, 200, stopApp(body.op)); // op omitted -> stop all lanes
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/open-url") {
    const body = await readBody(req);
    sendJson(res, 200, openExternalUrl(body.url));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/open-app") {
    const base = appBase();
    if (!base) {
      sendJson(res, 200, { ok: false, error: "The app isn't reachable yet." });
      return;
    }
    sendJson(res, 200, openExternalUrl(base));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/settings") {
    const body = await readBody(req);
    sendJson(res, 200, applySettings(body));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/fix") {
    const body = await readBody(req);
    sendJson(res, 200, await sendFix(body.kind, body));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/mcp/status") {
    sendJson(res, 200, await mcpStatus());
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/mcp/toggle") {
    const body = await readBody(req);
    sendJson(res, 200, await mcpToggle(body.enabled));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/mcp/scan") {
    const body = await readBody(req);
    sendJson(res, 200, await mcpScan(body.tool));
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

const serverUrl = await new Promise((resolve) => {
  server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
});

// ---------------------------------------------------------------------------
// Canvas declaration
// ---------------------------------------------------------------------------

function splitArgs(value) {
  if (!value) return null;
  if (Array.isArray(value)) return value;
  return String(value).trim().split(/\s+/).filter(Boolean);
}

function makeCanvas() {
  return createCanvas({
    id: "java-app",
    displayName: "Coffilot",
    description:
      "Build, test, package and run a Maven Java/Spring Boot app, watch live JVM metrics, run advisor scans, and push fixes back to the agent. Degrades gracefully by capability (plain Java → Spring Boot → Actuator → BootUI).",
    inputSchema: { type: "object", properties: {} },
    actions: [
      {
        name: "build_app",
        description: "Run a Maven build (default: ./mvnw -ntp -DskipTests install). Waits for completion.",
        inputSchema: {
          type: "object",
          properties: {
            args: { type: "string", description: "Override Maven args, space-separated (e.g. '-pl core test')." },
            mavenProfiles: { type: "string", description: "Maven build profiles to activate via -P (e.g. 'fast,it')." },
            warm: {
              type: "boolean",
              description:
                "Keep the JVM warm between runs by using the Maven Daemon (mvnd) when available for faster startup.",
            },
          },
        },
        handler: async (ctx) => build(splitArgs(ctx.input?.args), ctx.input?.warm === true, ctx.input?.mavenProfiles),
      },
      {
        name: "run_tests",
        description:
          "Run Maven tests (default: ./mvnw -ntp test) and return a parsed surefire report (per-suite counts plus failure details).",
        inputSchema: {
          type: "object",
          properties: {
            args: { type: "string", description: "Override Maven args, space-separated (e.g. '-pl core test')." },
            mavenProfiles: { type: "string", description: "Maven build profiles to activate via -P (e.g. 'fast,it')." },
            warm: {
              type: "boolean",
              description:
                "Keep the JVM warm between runs by using the Maven Daemon (mvnd) when available for faster startup.",
            },
          },
        },
        handler: async (ctx) => test(splitArgs(ctx.input?.args), ctx.input?.warm === true, ctx.input?.mavenProfiles),
      },
      {
        name: "package_app",
        description:
          "Run a Maven package build (default: ./mvnw -ntp package) to produce the artifact(s). Waits for completion. Shares the Maven lane with build/test (serialized), independent of a running app.",
        inputSchema: {
          type: "object",
          properties: {
            args: {
              type: "string",
              description: "Override Maven args, space-separated (e.g. '-pl core -DskipTests package').",
            },
            mavenProfiles: { type: "string", description: "Maven build profiles to activate via -P (e.g. 'fast,it')." },
            warm: {
              type: "boolean",
              description:
                "Keep the JVM warm between runs by using the Maven Daemon (mvnd) when available for faster startup.",
            },
          },
        },
        handler: async (ctx) =>
          packageApp(splitArgs(ctx.input?.args), ctx.input?.warm === true, ctx.input?.mavenProfiles),
      },
      {
        name: "start_app",
        description:
          "Launch the app (returns immediately; output streams to the canvas). Spring Boot modules run via spring-boot:run; otherwise the module is packaged and run with java -jar. Use the 'dev' profile so BootUI activates and live metrics become available.",
        inputSchema: {
          type: "object",
          properties: {
            module: { type: "string", description: "Maven module to run via -pl (e.g. 'web')." },
            profiles: {
              type: "string",
              description: "Spring profiles to activate (default 'dev'); ignored for non-Spring runs.",
            },
            mavenProfiles: { type: "string", description: "Maven build profiles to activate via -P (e.g. 'fast')." },
            mode: {
              type: "string",
              enum: ["spring", "java"],
              description: "Force the run strategy; defaults to auto-detect from the module.",
            },
          },
        },
        handler: async (ctx) =>
          startApp({
            module: ctx.input?.module,
            profiles: ctx.input?.profiles ?? "dev",
            mavenProfiles: ctx.input?.mavenProfiles,
            mode: ctx.input?.mode,
          }),
      },
      {
        name: "stop_app",
        description:
          "Stop a running lane. Pass op=build|test|package|run to stop one, op=maven to stop the build/test/package lane, or omit to stop all.",
        inputSchema: {
          type: "object",
          properties: { op: { type: "string", enum: ["build", "test", "package", "run", "maven"] } },
        },
        handler: async (ctx) => stopApp(ctx.input?.op),
      },
      {
        name: "get_status",
        description:
          "Return per-lane status (build/test/package/run: phase, last command, exit code, suggested fix), last test summary, live metrics tier, and a recent output tail.",
        inputSchema: { type: "object", properties: {} },
        handler: async () => ({
          ...statusSnapshot(),
          capabilities: capabilitiesSnapshot(),
          tail: tail(mostRelevantOp(), 40),
        }),
      },
      {
        name: "get_metrics",
        description:
          "Return live JVM metrics from the running app. Uses BootUI (/bootui/api) when present, else Spring Boot Actuator (/actuator), else process-only. appUp=false if it is not running.",
        inputSchema: { type: "object", properties: {} },
        handler: async () => (await refreshMetrics()) || lastMetrics,
      },
      {
        name: "fix_issue",
        description:
          "Send a context-rich request into this chat asking to fix the current problem. Kind: compile (build failed), package (package failed), test (failing tests), run-java/run-spring (startup failure), or mcp (advisor scan findings).",
        inputSchema: {
          type: "object",
          properties: {
            kind: {
              type: "string",
              enum: ["compile", "package", "test", "run-java", "run-spring", "mcp"],
              description: "Which failure to fix.",
            },
            tool: { type: "string", description: "For kind=mcp: the scan tool name." },
            result: { description: "For kind=mcp: the scan result payload to include." },
          },
          required: ["kind"],
        },
        handler: async (ctx) => sendFix(ctx.input?.kind, ctx.input || {}),
      },
      {
        name: "run_scan",
        description:
          "Run a BootUI MCP advisor scan against the running app (requires BootUI present and its MCP server enabled). Tool names end with _scan, e.g. architecture_scan, security_scan, spring_scan.",
        inputSchema: {
          type: "object",
          properties: { tool: { type: "string", description: "Scan tool name (…_scan)." } },
          required: ["tool"],
        },
        handler: async (ctx) => mcpScan(ctx.input?.tool),
      },
    ],
    open: async (ctx) => {
      const inst = instanceFor(ctx.instanceId);
      return {
        title: "Coffilot",
        status: lanes.run.phase === "running" ? `running on :${app.appPort ?? "?"}` : lanes.run.phase,
        url: `${serverUrl}/?instance=${encodeURIComponent(ctx.instanceId)}&token=${inst.token}`,
      };
    },
    onClose: async (ctx) => {
      sseClients.delete(ctx.instanceId);
    },
  });
}
