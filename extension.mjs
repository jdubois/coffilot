// Extension: coffilot
//
// Coffilot — a GitHub Copilot canvas extension that turns a Maven- or Gradle-based
// Java / Spring Boot project into an interactive console: Build, Test, Package, Run
// and Stop the app, watch the build output stream live, and — once the app is up —
// read live JVM metrics from the richest source available (BootUI → Actuator →
// process). Failures surface a "Fix with Copilot" button that pushes the error
// context back into the chat.
//
// The build tool is auto-detected from the project: Maven (pom.xml / ./mvnw) is
// preferred when present, otherwise Gradle (build.gradle[.kts] / ./gradlew). When
// neither is found the canvas degrades to a "needs Maven or Gradle" message.
//
// Metrics tiers:
//   * Build / test / package / run orchestration (shelling out to the project's
//     wrapper — ./mvnw or ./gradlew — or a system mvn/gradle) lives here in the
//     Node process.
//   * Live JVM metrics are read from a running app: when the app exposes BootUI
//     (https://github.com/jdubois/boot-ui) it serves sanitized record DTOs at
//     /bootui/api/overview, /live-memory, /health, /threads, which this canvas
//     proxies and renders; otherwise it falls back to Actuator, then to coarse
//     process metrics. BootUI also unlocks the MCP advisor-scan panel.

import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { readFile, readdir, stat } from "node:fs/promises";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  mkdirSync,
  writeFileSync,
  unlinkSync,
  watch as fsWatch,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, joinSession } from "@github/copilot-sdk/extension";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Session + workspace wiring
// ---------------------------------------------------------------------------

const isWindows = process.platform === "win32";

const session = await joinSession({ canvases: [makeCanvas()] });

// Project marker files used to locate the root and decide the build tool. Defined
// here (before the resolution below) so findProjectRoot/detectBuildTool can read
// them without hitting a temporal-dead-zone error during early startup.
const MAVEN_MARKERS = ["pom.xml", "mvnw", "mvnw.cmd"];
const GRADLE_MARKERS = [
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "gradlew",
  "gradlew.bat",
];

// Resolve the project root. The authoritative source is the session's primary
// working directory (the project the user opened), read from the permission-paths
// API. session.workspacePath is the session-artifacts folder, never the repo;
// __dirname points into the coffilot repo for a user/global install; and the host
// launches us with cwd=<COPILOT_HOME>, not the project. We fall back to __dirname
// (project-embedded install at <repo>/.github/extensions/coffilot) and cwd.
const sessionPrimaryDir = await getSessionPrimaryDir();
const workspacePath = findProjectRoot(sessionPrimaryDir);

// Auto-detect the build tool from the project. Maven wins when both are present,
// per Coffilot's "prefer Maven" rule; null means neither was found (degraded UI).
const buildTool = detectBuildTool(workspacePath); // "maven" | "gradle" | null
const TOOL_LABEL = buildTool === "gradle" ? "Gradle" : buildTool === "maven" ? "Maven" : null;

// The committed wrapper for the active tool, preferred over a system binary
// because it pins the tool version. Gradle ships gradlew / gradlew.bat; Maven
// ships mvnw / mvnw.cmd.
const wrapperName = buildTool === "gradle" ? (isWindows ? "gradlew.bat" : "gradlew") : isWindows ? "mvnw.cmd" : "mvnw";
const wrapperPath = path.join(workspacePath, wrapperName);

// Silence the JDK native-access warnings (JEP 472) that Jansi (Maven's native
// console) and FFM-using app dependencies emit at startup. The flag exists
// since JDK 16, so it's safe for the Java 17+ toolchain and apps this canvas
// runs. Applied to the build-tool JVM (via MAVEN_OPTS/GRADLE_OPTS) and, for
// Maven, the launched app JVM.
const NATIVE_ACCESS_FLAG = "--enable-native-access=ALL-UNNAMED";

// Merge the native-access flag into the build tool's JVM options (MAVEN_OPTS for
// Maven, GRADLE_OPTS for Gradle) so the build JVM doesn't print restricted-method
// warnings, while preserving whatever the user already set. `extra` adds/overrides
// environment variables for a specific spawn (e.g. SPRING_PROFILES_ACTIVE).
function toolEnv(extra) {
  const env = { ...process.env, ...(extra || {}) };
  if (buildTool === "gradle") {
    const existing = process.env.GRADLE_OPTS ? process.env.GRADLE_OPTS.trim() + " " : "";
    env.GRADLE_OPTS = existing + NATIVE_ACCESS_FLAG;
  } else {
    const existing = process.env.MAVEN_OPTS ? process.env.MAVEN_OPTS.trim() + " " : "";
    env.MAVEN_OPTS = existing + NATIVE_ACCESS_FLAG;
  }
  return env;
}

/** Decide the build tool for a project root: Maven preferred, else Gradle, else null. */
function detectBuildTool(root) {
  const has = (f) => existsSync(path.join(root, f));
  if (MAVEN_MARKERS.some(has)) return "maven";
  if (GRADLE_MARKERS.some(has)) return "gradle";
  return null;
}

/** A short result returned by actions/endpoints when no build tool was detected. */
function noToolResult() {
  return {
    ok: false,
    error: "Coffilot needs a Maven or Gradle project, but neither was detected in this folder.",
  };
}

// "Keep JVM warm" uses the Maven Daemon (mvnd) when available: mvnd keeps a pool
// of warm JVMs alive between invocations, so repeated build/test runs skip JVM
// startup + JIT warmup. We auto-detect it and fall back to ./mvnw otherwise.
// (Gradle has an always-on daemon, so its warm tier needs no separate binary.)

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

// When a project uses Gradle but ships no wrapper, fall back to a system `gradle`
// discovered on PATH (and common install locations). Mirrors detectMvn().
let gradleInfo = null;
function detectGradle() {
  if (gradleInfo) return gradleInfo;
  // Windows resolves `gradle` to a batch script (gradle.bat) or a shim exe.
  const exeNames = isWindows ? ["gradle.bat", "gradle.exe", "gradle"] : ["gradle"];
  const candidates = [];
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    for (const exe of exeNames) candidates.push(path.join(dir, exe));
  }
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (isWindows) {
    if (home) {
      candidates.push(
        path.join(home, "scoop", "shims", "gradle.bat"),
        path.join(home, "scoop", "shims", "gradle.exe"),
        path.join(home, ".sdkman", "candidates", "gradle", "current", "bin", "gradle.bat"),
      );
    }
    if (process.env.ProgramData) {
      candidates.push(path.join(process.env.ProgramData, "chocolatey", "bin", "gradle.exe"));
    }
  } else {
    candidates.push(
      "/opt/homebrew/bin/gradle",
      "/usr/local/bin/gradle",
      "/usr/bin/gradle",
      "/home/linuxbrew/.linuxbrew/bin/gradle",
    );
    if (home) candidates.push(path.join(home, ".sdkman/candidates/gradle/current/bin/gradle"));
  }
  for (const c of candidates) {
    try {
      if (existsSync(c)) {
        gradleInfo = { available: true, path: c };
        return gradleInfo;
      }
    } catch {
      /* ignore */
    }
  }
  gradleInfo = { available: false, path: null };
  return gradleInfo;
}

/** A system binary for the active tool (mvn or gradle), discovered on PATH. */
function detectSystemTool() {
  return buildTool === "gradle" ? detectGradle() : detectMvn();
}

// The base (non-daemon) command for a run: the project's wrapper when it exists,
// else a system binary (mvn / gradle) from PATH. mvnd layers on top of this for
// warm Maven builds. Cached because neither the wrapper's presence nor PATH
// change at runtime.
let baseRunnerInfo = null;
function baseRunner() {
  if (baseRunnerInfo) return baseRunnerInfo;
  const wrapperLabel = buildTool === "gradle" ? "./gradlew" : "./mvnw";
  const systemLabel = buildTool === "gradle" ? "gradle" : "mvn";
  if (existsSync(wrapperPath)) {
    baseRunnerInfo = { bin: wrapperPath, label: wrapperLabel };
  } else {
    const sys = detectSystemTool();
    // Fall back to the system binary; if that's missing too, keep pointing at the
    // wrapper path so the spawn fails with a clear ENOENT in the lane console.
    baseRunnerInfo = sys.available ? { bin: sys.path, label: systemLabel } : { bin: wrapperPath, label: wrapperLabel };
  }
  return baseRunnerInfo;
}

/** Whether the active tool can actually be invoked (wrapper present or on PATH). */
function toolAvailable() {
  return buildTool != null && (existsSync(wrapperPath) || detectSystemTool().available);
}

// Capability describing the "Keep JVM warm" tier for the active tool. Maven uses
// mvnd (optional, install-gated); Gradle uses its built-in daemon (always on).
function warmCapability() {
  if (buildTool === "gradle") {
    return {
      available: true,
      kind: "gradle-daemon",
      label: "Keep JVM warm (Gradle daemon)",
      tip: "Use the Gradle daemon to keep a warm JVM between builds/tests for faster repeat runs (it is on by default).",
      install: { os: null, cmd: null, url: null },
    };
  }
  const m = detectMvnd();
  return {
    available: m.available,
    kind: "mvnd",
    label: m.available ? "Keep JVM warm (mvnd)" : "Keep JVM warm",
    tip: m.available
      ? "Use the Maven Daemon (mvnd) to keep a warm JVM pool between builds/tests for faster repeat runs."
      : "Install the Maven Daemon (mvnd) to enable the warm-JVM option.",
    install: mvndInstallHint(),
  };
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

// ---------------------------------------------------------------------------
// JDTLS (Eclipse JDT Language Server) detection
// ---------------------------------------------------------------------------
//
// JDTLS powers the Copilot CLI's Java code intelligence (go-to-definition, find
// references, hover, …). It is NOT part of this extension: the CLI launches it
// out-of-process from whatever its lsp-config declares. So "is JDTLS available?"
// is the conjunction of three things the CLI itself needs:
//   1. The CLI is wired to a Java language server — its lsp-config maps `.java`.
//   2. That server's launcher command resolves to a real executable on disk.
//   3. A JDK new enough to run JDTLS (Java 21+) is what would launch it.
// We also surface whether it has already indexed this project (a populated
// `-data` workspace), which is strong proof it actually ran here. The detection
// mirrors exactly what the CLI does rather than hard-coding "jdtls", so it stays
// correct if the user points the Java server at a different launcher.

const JDTLS_MIN_JAVA = 21; // Eclipse JDT LS 1.x requires a Java 21+ runtime.

// Copilot CLI config dirs, most-specific first. Honor explicit overrides, then
// the conventional ~/.copilot home.
function copilotConfigDirs() {
  const dirs = [];
  for (const v of [process.env.COPILOT_CONFIG_DIR, process.env.COPILOT_HOME, process.env.GH_COPILOT_HOME]) {
    if (v) dirs.push(v);
  }
  const home = os.homedir();
  if (home) dirs.push(path.join(home, ".copilot"));
  return dirs;
}

// The Java language-server entry the CLI would load: the first lsp-config.json
// under a config dir that maps `.java` to a server. lsp-config.json is the
// canonical active file (the *-java / *-jdtls / *-grep variants are presets the
// user swaps in). Returns { id, command, args, file } or null.
function readJavaLspConfig() {
  for (const dir of copilotConfigDirs()) {
    const file = path.join(dir, "lsp-config.json");
    let json;
    try {
      json = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    const servers = json && json.lspServers;
    if (!servers || typeof servers !== "object") continue;
    for (const [id, cfg] of Object.entries(servers)) {
      const exts = cfg && cfg.fileExtensions;
      const mapsJava = exts && typeof exts === "object" && Object.keys(exts).some((e) => e.toLowerCase() === ".java");
      if (mapsJava && cfg.command) {
        return { id, command: cfg.command, args: Array.isArray(cfg.args) ? cfg.args : [], file };
      }
    }
  }
  return null;
}

// Resolve an executable by name across PATH + common package-manager bin dirs
// (mirrors detectMvn's strategy). An explicit path in the config is honored as-is.
function resolveExecutable(command) {
  if (!command) return null;
  if (command.includes("/") || command.includes("\\")) {
    return existsSync(command) ? command : null;
  }
  const exeNames = isWindows ? [command + ".cmd", command + ".bat", command + ".exe", command] : [command];
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const extra = isWindows ? [] : ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/home/linuxbrew/.linuxbrew/bin"];
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (home && !isWindows) {
    extra.push(path.join(home, ".local/bin"));
    extra.push(path.join(home, ".local/share/nvim/mason/bin")); // nvim/mason installs jdtls here
  }
  for (const dir of [...dirs, ...extra]) {
    for (const exe of exeNames) {
      const c = path.join(dir, exe);
      try {
        if (existsSync(c)) return c;
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

// The JDK that would actually launch JDTLS: JAVA_HOME if set (launchers honor it),
// else `java` on PATH. We read its major version to confirm the Java 21+ floor.
// Cached only once adequate, so fixing JAVA_HOME and refocusing self-heals.
let runtimeJdkInfo = null;
function detectRuntimeJdk() {
  if (runtimeJdkInfo && runtimeJdkInfo.ok) return runtimeJdkInfo;
  const info = { ok: false, version: null, major: null, home: process.env.JAVA_HOME || null };
  const bin = info.home ? path.join(info.home, "bin", isWindows ? "java.exe" : "java") : "java";
  try {
    const res = spawnSync(bin, ["-version"], { encoding: "utf8", timeout: 5000 });
    const out = `${res.stderr || ""}${res.stdout || ""}`;
    const m = out.match(/version "([^"]+)"/); // e.g. "21.0.2" or legacy "1.8.0_392"
    if (m) {
      info.version = m[1];
      const parts = m[1].split(".");
      const major = parts[0] === "1" ? parseInt(parts[1], 10) : parseInt(parts[0], 10);
      if (!Number.isNaN(major)) {
        info.major = major;
        info.ok = major >= JDTLS_MIN_JAVA;
      }
    }
  } catch {
    /* no resolvable java */
  }
  runtimeJdkInfo = info;
  return info;
}

// The JDTLS `-data` workspace dir from the config args. A relative path is
// created by the CLI relative to its working dir, which is normally the Maven
// project root but can differ from the extension's own cwd, so callers resolve
// it against several candidate bases. Defaults to .jdtls-workspace.
function jdtlsDataArg(cfg) {
  const args = (cfg && cfg.args) || [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-data" && args[i + 1]) return args[i + 1];
    if (typeof a === "string" && a.startsWith("-data=")) return a.slice("-data=".length);
  }
  return ".jdtls-workspace";
}

// True once JDTLS has created its JDT LS core state in the data workspace, which
// only happens after it has actually launched and started indexing a project.
// For a relative -data path we probe the likely project roots.
function jdtlsHasIndexed(cfg) {
  const dataArg = jdtlsDataArg(cfg);
  const bases = path.isAbsolute(dataArg)
    ? [dataArg]
    : [...new Set([workspacePath, process.cwd()])].map((b) => path.join(b, dataArg));
  return bases.some((dir) => {
    try {
      return existsSync(path.join(dir, ".metadata", ".plugins", "org.eclipse.jdt.ls.core"));
    } catch {
      return false;
    }
  });
}

// Platform guidance for installing the JDTLS launcher, used when it's missing.
function jdtlsInstallHint() {
  const url = "https://github.com/eclipse-jdtls/eclipse.jdt.ls";
  if (isWindows) return { os: "Windows", cmd: "scoop install jdtls", url };
  if (process.platform === "darwin") return { os: "macOS", cmd: "brew install jdtls", url };
  return { os: "Linux", cmd: "brew install jdtls", url };
}

// Cached only once fully available, so installing/repairing JDTLS while the
// canvas is open self-heals on the next focus-triggered env refresh.
let jdtlsInfo = null;
function detectJdtls() {
  if (jdtlsInfo && jdtlsInfo.available) return jdtlsInfo;
  const cfg = readJavaLspConfig();
  const configured = !!cfg;
  const command = cfg ? cfg.command : "jdtls";
  const launcher = resolveExecutable(command);
  const jdk = detectRuntimeJdk();
  // Only let the JDK gate availability when we positively detect an inadequate
  // one; an undetectable java shouldn't cause a false negative (a launcher may
  // pin its own JAVA_HOME).
  const javaInadequate = !!(jdk.version && !jdk.ok);
  const available = !!(configured && launcher && !javaInadequate);
  let reason = null;
  if (!configured) reason = "no-config";
  else if (!launcher) reason = "no-launcher";
  else if (javaInadequate) reason = "old-jdk";
  jdtlsInfo = {
    available,
    configured,
    command,
    launcher,
    java: jdk,
    indexed: jdtlsHasIndexed(cfg),
    reason,
    minJava: JDTLS_MIN_JAVA,
    configFile: cfg ? cfg.file : path.join(copilotConfigDirs()[0] || "~/.copilot", "lsp-config.json"),
    install: jdtlsInstallHint(),
  };
  return jdtlsInfo;
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

/**
 * Pick the binary + args modifier for a build/test run.
 *  - Maven: mvnd only when "warm" is requested and available, else the wrapper/mvn.
 *  - Gradle: always the wrapper/gradle; "warm" toggles the daemon (the arg builder
 *    adds --no-daemon when warm is off) and is reported as the lane's warm state.
 */
function resolveRunner(warm) {
  if (buildTool === "gradle") {
    const b = baseRunner();
    return { bin: b.bin, label: b.label, warm: !!warm };
  }
  if (warm) {
    const m = detectMvnd();
    if (m.available) return { bin: m.path, label: "mvnd", warm: true };
  }
  const b = baseRunner();
  return { bin: b.bin, label: b.label, warm: false };
}

/** Gradle keeps its daemon warm by default; cold runs opt out with --no-daemon. */
function gradleWarmFlags(warm) {
  return warm ? [] : ["--no-daemon"];
}

/** Gradle task path for a module: "" → bare task; "web" → ":web:task"; "a/b" → ":a:b:task". */
function gradleTaskPath(module, task) {
  if (!module) return task;
  return ":" + String(module).split("/").filter(Boolean).join(":") + ":" + task;
}

/** Resolve a Gradle module's build file, preferring the Kotlin DSL when present. */
function gradleModuleBuildFile(moduleName) {
  const dir = path.join(workspacePath, moduleName || "");
  const kts = existsSync(path.join(dir, "build.gradle.kts"));
  const rel = path.join(moduleName || "", kts ? "build.gradle.kts" : "build.gradle");
  return { rel, kts };
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

// Read the session's primary working directory (the project the user opened) via
// the permission-paths API. This is the only reliable signal for a user/global
// install, where the host runs the extension with cwd=<COPILOT_HOME> and __dirname
// resolves into the coffilot repo. Older hosts may not implement it, so failures
// are tolerated and we fall back to path heuristics.
async function getSessionPrimaryDir() {
  try {
    const res = await session.rpc?.permissions?.paths?.list?.();
    if (res && typeof res.primary === "string" && res.primary) return res.primary;
  } catch (e) {
    session.log(`[coffilot] could not read session working directory: ${e.message}`, { level: "warn" });
  }
  return null;
}

function findProjectRoot(primary) {
  const markers = [...MAVEN_MARKERS, ...GRADLE_MARKERS];
  const owns = (dir) => markers.some((f) => existsSync(path.join(dir, f)));
  // Walk up from `start` (max 8 hops) to the first directory that owns a Maven or
  // Gradle build marker; null if `start` is falsy or none is found.
  const walkUp = (start) => {
    if (!start) return null;
    let dir = start;
    for (let i = 0; i < 8; i++) {
      if (owns(dir)) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  };
  // 1) The session's primary working directory is the project the user opened —
  //    the most reliable signal, and the only one that works for a user/global
  //    install (where the host runs the extension with cwd=<COPILOT_HOME> and
  //    __dirname is the coffilot repo).
  // 2) Project-embedded install (.github/extensions/coffilot): walk up from here.
  // 3) Launch cwd, as a last resort for older hosts that don't expose (1).
  // If nothing owns a build marker, still prefer the opened project dir over cwd.
  return walkUp(primary) || walkUp(__dirname) || walkUp(process.cwd()) || primary || process.cwd();
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
    warm: warmCapability().available, // on by default when a warm tier exists (mvnd / Gradle daemon)
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
// tagged with the capabilities detectable from its own build file: "runnable"
// (a Spring Boot app, so it can be launched with spring-boot:run / bootRun),
// springBoot, actuator, devtools, and bootui. These drive graceful UI degradation.
// Non-Spring modules additionally carry "mainClass" (a configured main class, so
// the generic runner can fall back to `java -cp …`) and, for Gradle, "application"
// (the application plugin, whose `run` task is the canonical generic launcher).
let projectModules = null;

// A configured main class, read from common Maven run/packaging plugin config or
// properties. Used by the generic runner when no executable jar is produced.
function pomMainClass(xml) {
  for (const re of [
    /<exec\.mainClass>\s*([\w.$]+)\s*<\/exec\.mainClass>/, // exec-maven-plugin property
    /<start-class>\s*([\w.$]+)\s*<\/start-class>/, // Spring Boot / generic start-class property
    /<mainClass>\s*([\w.$]+)\s*<\/mainClass>/, // jar / shade / assembly / exec plugin config
  ]) {
    const m = xml.match(re);
    if (m) return m[1];
  }
  return null;
}

// Per-pom capability flags, derived purely from the pom text (cheap + offline).
function pomCaps(xml, name) {
  return {
    name,
    runnable: xml.includes("spring-boot-maven-plugin"),
    springBoot: xml.includes("spring-boot-maven-plugin") || xml.includes("org.springframework.boot"),
    actuator: xml.includes("spring-boot-starter-actuator"),
    devtools: xml.includes("spring-boot-devtools"),
    bootui: /bootui-spring-boot-starter|julien-dubois\.bootui|jdubois\.bootui/.test(xml),
    mainClass: pomMainClass(xml),
  };
}

// A configured main class from a Gradle build script: the application/JavaExec
// `mainClass`, the legacy `mainClassName`, or a jar `Main-Class` manifest attribute.
function gradleMainClass(text) {
  for (const re of [
    /mainClass\s*\.\s*set\s*\(\s*['"]([\w.$]+)['"]\s*\)/, // mainClass.set("…")
    /mainClass\s*=\s*['"]([\w.$]+)['"]/, // mainClass = "…"
    /mainClassName\s*=\s*['"]([\w.$]+)['"]/, // legacy mainClassName = "…"
    /['"]Main-Class['"]\s*[:=]\s*['"]([\w.$]+)['"]/, // manifest attribute
  ]) {
    const m = text.match(re);
    if (m) return m[1];
  }
  return null;
}

// Whether a Gradle build script applies the `application` plugin (Groovy or Kotlin
// DSL, plugins {} block or legacy apply). Its `run` task is the generic launcher.
function gradleHasApplicationPlugin(text) {
  return (
    /id\s*\(?\s*['"]application['"]/.test(text) ||
    /apply\s+plugin:\s*['"]application['"]/.test(text) ||
    /^\s*application\s*\{/m.test(text) ||
    /^\s*application\s*$/m.test(text)
  );
}

// Per-build-file capability flags for Gradle, derived from the build script text
// (Groovy or Kotlin DSL). Spring Boot is detected from its Gradle plugin id.
function gradleCaps(text, name) {
  return {
    name,
    runnable: text.includes("org.springframework.boot"),
    springBoot: text.includes("org.springframework.boot"),
    actuator: text.includes("spring-boot-starter-actuator"),
    devtools: text.includes("spring-boot-devtools"),
    bootui: /bootui-spring-boot-starter|julien-dubois\.bootui|jdubois\.bootui/.test(text),
    application: gradleHasApplicationPlugin(text),
    mainClass: gradleMainClass(text),
  };
}

// The project's own artifactId (skip the <parent> block so we don't read the
// parent/BOM artifactId by mistake). Used as a display label for the root module.
function artifactIdOf(xml) {
  const noParent = xml.replace(/<parent>[\s\S]*?<\/parent>/, "");
  const m = noParent.match(/<artifactId>\s*([^<]+?)\s*<\/artifactId>/);
  return m ? m[1] : null;
}

/** Read a module's Gradle build script (Groovy or Kotlin DSL), or null if absent. */
function readGradleBuildFile(dir) {
  for (const f of ["build.gradle", "build.gradle.kts"]) {
    try {
      return readFileSync(path.join(dir, f), "utf8");
    } catch {
      /* try next */
    }
  }
  return null;
}

/** rootProject.name from a settings script, used to label a single-module root. */
function gradleRootName(settings) {
  if (!settings) return null;
  const m = settings.match(/rootProject\.name\s*=\s*['"]([^'"]+)['"]/);
  return m ? m[1] : null;
}

// Parse `include` statements from a settings.gradle[.kts] file into module paths.
// Handles Groovy and Kotlin DSL, single- or multi-project includes on one line,
// e.g. `include ':web', ':lib'` or `include(":web", ":services:api")`. The
// statement-boundary anchor and `(?!Build|Flat)` lookahead keep composite-build
// declarations (`includeBuild`, `includeFlat`) out of the subproject list.
function parseGradleIncludes(text) {
  const names = [];
  const seen = new Set();
  for (const m of text.matchAll(/(?:^|\n)\s*include(?!Build|Flat)\b\s*\(?([^\n)]*)\)?/g)) {
    for (const q of m[1].matchAll(/['"]([^'"]+)['"]/g)) {
      // Gradle project paths are colon-separated; map to a relative directory.
      const rel = q[1].replace(/^:/, "").split(":").filter(Boolean).join("/");
      if (rel && !seen.has(rel)) {
        seen.add(rel);
        names.push(rel);
      }
    }
  }
  return names;
}

function listMavenModules() {
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
  return out;
}

function listGradleModules() {
  const out = [];
  let settings = null;
  for (const f of ["settings.gradle", "settings.gradle.kts"]) {
    try {
      settings = readFileSync(path.join(workspacePath, f), "utf8");
      break;
    } catch {
      /* try next */
    }
  }
  for (const rel of settings ? parseGradleIncludes(settings) : []) {
    const text = readGradleBuildFile(path.join(workspacePath, rel)) || "";
    const caps = gradleCaps(text, rel);
    caps.artifactId = rel.split("/").pop();
    out.push(caps);
  }
  // Single-module project (no includes): represent the root build script itself.
  // name="" means "no module path" everywhere (bare Gradle tasks).
  if (!out.length) {
    const text = readGradleBuildFile(workspacePath);
    if (text != null) {
      const root = gradleCaps(text, "");
      root.artifactId = gradleRootName(settings) || path.basename(workspacePath) || "app";
      out.push(root);
    }
  }
  return out;
}

function listModules() {
  if (projectModules) return projectModules;
  let out = [];
  try {
    if (buildTool === "maven") out = listMavenModules();
    else if (buildTool === "gradle") out = listGradleModules();
  } catch {
    /* ignore */
  }
  projectModules = out;
  return projectModules;
}

// Best-effort Java version from the project's build files (Maven pom properties
// or Gradle toolchain / source-compatibility declarations).
let javaVersion = undefined;
function detectJavaVersion() {
  if (javaVersion !== undefined) return javaVersion;
  javaVersion = null;
  if (buildTool === "gradle") {
    const text = readGradleBuildFile(workspacePath);
    if (text) {
      for (const re of [
        /JavaLanguageVersion\.of\(\s*(\d+)\s*\)/,
        /JavaVersion\.VERSION_(\d+)/,
        /(?:source|target)Compatibility\s*=?\s*['"]?(?:1\.)?(\d+)/,
        /['"]?(?:source|target)Compatibility['"]?\s*\(\s*['"]?(?:1\.)?(\d+)/,
      ]) {
        const m = text.match(re);
        if (m) {
          javaVersion = m[1];
          break;
        }
      }
    }
    return javaVersion;
  }
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

// Static capability tiers, derived from the build files. The runtime metrics tier
// (refreshMetrics) is authoritative once the app is up; these are the hints the
// UI uses before/while running to decide what controls to show.
function capabilitiesSnapshot() {
  const mods = listModules();
  return {
    buildTool,
    toolLabel: TOOL_LABEL,
    available: toolAvailable(),
    maven: buildTool === "maven",
    gradle: buildTool === "gradle",
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
// datalist instead of a free-text box. Gradle has no profile concept, so the list
// is empty there and the UI hides the control.
let mavenProfiles = null;
function listMavenProfiles() {
  if (buildTool !== "maven") return [];
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
  let args;
  if (buildTool === "gradle") {
    // `classes` compiles main sources; Spring Boot DevTools watches build/classes
    // and restarts the running app when they change.
    args = [gradleTaskPath(ctx.module, "classes"), "-q", "--console=plain"];
  } else {
    args = ["-ntp", "-q", "-Dmaven.test.skip=true"];
    if (ctx.module) args.push("-pl", ctx.module);
    if (ctx.mavenProfiles && String(ctx.mavenProfiles).trim()) args.push("-P", String(ctx.mavenProfiles).trim());
    args.push("compile");
  }
  let out = "";
  let child;
  try {
    child = spawn(ctx.bin, args, { cwd: workspacePath, env: toolEnv(), shell: isWindows });
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

/** Build-tool + warm-JVM capabilities the UI uses to adapt its controls. */
function envSnapshot() {
  const warm = warmCapability();
  const m = buildTool === "maven" ? detectMvnd() : { available: false, path: null };
  return {
    buildTool,
    toolLabel: TOOL_LABEL,
    available: toolAvailable(),
    modules: listModules(),
    mavenProfiles: listMavenProfiles(),
    profilesSupported: buildTool === "maven",
    springProfiles: listSpringProfiles(),
    capabilities: capabilitiesSnapshot(),
    settings: settingsSnapshot(),
    // Warm-JVM tier (mvnd for Maven, daemon for Gradle).
    warmAvailable: warm.available,
    warmKind: warm.kind,
    warmLabel: warm.label,
    warmTip: warm.tip,
    install: warm.install,
    jdtls: detectJdtls(),
    // Back-compat fields retained for any external consumers.
    mvndAvailable: m.available,
    mvndPath: m.path,
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
// Build-tool runner
// ---------------------------------------------------------------------------

/**
 * Spawn the build tool (or `java`) for one op's lane, stream output into that
 * lane's console, and resolve with the exit code. `op` is "build" | "test" |
 * "package" | "run". `env` overrides the spawn environment (defaults to toolEnv()).
 */
function spawnTool(op, args, phase, { onLine, bin, label, env } = {}) {
  const lane = lanes[op];
  const base = baseRunner();
  const toolBin = bin || base.bin;
  const toolLabel = label || base.label;
  return new Promise((resolve) => {
    lane.phase = phase;
    lane.runnerLabel = toolLabel;
    lane.command = `${toolLabel} ${args.join(" ")}`;
    lane.exitCode = null;
    broadcast("reset", { op });
    lane.console = [];
    broadcast("status", statusSnapshot());
    session.log(`[coffilot] ${lane.command}`, { level: "info", ephemeral: true });

    const child = spawn(toolBin, args, {
      cwd: workspacePath,
      env: env || toolEnv(),
      // mvnw.cmd / mvnd.cmd / gradlew.bat are batch scripts; modern Node refuses
      // to spawn .cmd/.bat directly, so route through the shell on Windows.
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
      pushConsole(`[coffilot] failed to start ${toolLabel}: ${err.message}`, "stderr", op);
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

// Append Maven profile activation (-P). No-op for Gradle, which has no profiles.
function withMavenProfiles(args, mavenProfiles) {
  if (buildTool !== "maven") return args;
  const p = mavenProfiles && String(mavenProfiles).trim();
  return p ? [...args, "-P", p] : args;
}

// Default argument vectors per lane, per tool. `warm` only affects Gradle (daemon
// vs --no-daemon); Maven's warm tier swaps the binary (mvnd) instead.
function defaultBuildArgs(warm) {
  if (buildTool === "gradle") return ["build", "-x", "test", "--console=plain", ...gradleWarmFlags(warm)];
  return ["-ntp", "-DskipTests", "install"];
}
function defaultTestArgs(warm) {
  // cleanTest forces Gradle to re-run tests even when nothing changed, so the
  // canvas always produces a fresh report (mirroring Maven's always-run test).
  if (buildTool === "gradle") return ["cleanTest", "test", "--console=plain", ...gradleWarmFlags(warm)];
  return ["-ntp", "test"];
}
function defaultPackageArgs(warm) {
  if (buildTool === "gradle") return ["assemble", "--console=plain", ...gradleWarmFlags(warm)];
  return ["-ntp", "package"];
}

async function build(extraArgs, warm, mavenProfiles) {
  if (!buildTool) {
    pushConsole("[coffilot] No Maven or Gradle project detected.", "stderr", "build");
    return noToolResult();
  }
  if (mvnLaneBusy()) return { ok: false, error: "A build, test or package is already running. Stop it first." };
  const r = resolveRunner(warm);
  const base = extraArgs && extraArgs.length ? extraArgs : defaultBuildArgs(r.warm);
  const args = withMavenProfiles(base, mavenProfiles);
  lanes.build.warm = r.warm;
  const code = await spawnTool("build", args, "building", { bin: r.bin, label: r.label });
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
  if (!buildTool) {
    pushConsole("[coffilot] No Maven or Gradle project detected.", "stderr", "package");
    return noToolResult();
  }
  if (mvnLaneBusy()) return { ok: false, error: "A build, test or package is already running. Stop it first." };
  const r = resolveRunner(warm);
  const base = extraArgs && extraArgs.length ? extraArgs : defaultPackageArgs(r.warm);
  const args = withMavenProfiles(base, mavenProfiles);
  lanes.package.warm = r.warm;
  const code = await spawnTool("package", args, "packaging", { bin: r.bin, label: r.label });
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
  if (!buildTool) {
    pushConsole("[coffilot] No Maven or Gradle project detected.", "stderr", "test");
    return noToolResult();
  }
  if (mvnLaneBusy()) return { ok: false, error: "A build, test or package is already running. Stop it first." };
  const r = resolveRunner(warm);
  const base = extraArgs && extraArgs.length ? extraArgs : defaultTestArgs(r.warm);
  const args = withMavenProfiles(base, mavenProfiles);
  lanes.test.warm = r.warm;
  lastTestReport = null;
  broadcast("tests", null);
  // Seed the progress-bar estimate: persisted total if we have one, otherwise
  // the total from any test reports already on disk (a prior run), so the
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
  // Live per-class progress is parsed from Surefire's console output (Maven only);
  // Gradle's default output isn't per-test, so its graphical view fills in from
  // the JUnit XML report once the run finishes.
  const onLine = buildTool === "maven" ? onTestLine : undefined;
  const code = await spawnTool("test", args, "testing", { bin: r.bin, label: r.label, onLine });
  if (testProgress) {
    testProgress.running = false;
    broadcastTestProgress();
  }
  const report = await collectSurefireReport(testRunStartedAt);
  lastTestReport = report;
  lastTest = report.summary;
  // Persist the total only when the tool exited on its own (code is a number).
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
  if (!buildTool) {
    pushConsole("[coffilot] No Maven or Gradle project detected.", "stderr", "run");
    return noToolResult();
  }
  if (runLaneBusy()) return { ok: false, error: "The app is already running. Stop it first." };
  lanes.run.warm = false;
  app.appPort = null;
  app.appUp = false;
  app.appReachedUp = false;
  csrfToken = null;
  lastMetrics = { appUp: false };

  // Pick the run strategy: explicit mode wins, else infer from whether the
  // chosen module applies the Spring Boot plugin.
  const mod = listModules().find((m) => m.name === module);
  const resolved = mode === "java" || mode === "spring" ? mode : mod && mod.runnable ? "spring" : "java";
  app.runMode = resolved;
  app.module = module || "";
  app.mavenProfiles = mavenProfiles || null;

  if (resolved === "spring") {
    // The app is long-lived, so it always runs via the wrapper/system tool
    // (Maven's mvnd warm tier is for builds, not a foreground server).
    const r = resolveRunner(false);

    if (buildTool === "gradle") {
      // bootRun forks the app JVM; profiles and port flow through env vars
      // (SPRING_PROFILES_ACTIVE / SERVER_PORT) to avoid cross-platform --args
      // quoting pitfalls.
      const args = [gradleTaskPath(module, "bootRun"), "--console=plain"];
      const extra = {};
      if (profiles) extra.SPRING_PROFILES_ACTIVE = profiles;
      if (settings.randomPort) {
        let port = 0;
        try {
          port = await freePort();
        } catch {
          /* fall back: leave SERVER_PORT unset and let the app keep its default */
        }
        if (port) {
          extra.SERVER_PORT = String(port);
          pushConsole(`[coffilot] using HTTP port ${port} via SERVER_PORT.`, "stdout", "run");
        }
      }
      spawnTool("run", args, "running", { bin: r.bin, label: r.label, env: toolEnv(extra), onLine: detectPort });
      if (settings.devtools && mod && mod.devtools) {
        startLiveReload({ module: module || "", mavenProfiles, bin: r.bin, label: r.label });
      }
      return { ok: true, started: true, mode: "spring", command: `${r.label} ${args.join(" ")}` };
    }

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
    spawnTool("run", args, "running", { onLine: detectPort }); // fire-and-forget
    // DevTools restarts in place when target/classes changes, so watch sources
    // and recompile on save to drive that loop automatically.
    if (settings.devtools && mod && mod.devtools) {
      const lr = resolveRunner(true);
      startLiveReload({ module: module || "", mavenProfiles, bin: lr.bin, label: lr.label });
    }
    return { ok: true, started: true, mode: "spring", command: `${baseRunner().label} ${args.join(" ")}` };
  }

  // Non-Spring: hand off to the generic runner (Gradle application run /
  // executable jar via java -jar / configured main class via java -cp).
  runPureJava({ module, mavenProfiles });
  return { ok: true, started: true, mode: "java" };
}

/** Mark the Run lane failed with a console message (used by the generic runner
 * when it can't find anything launchable). */
function failRunLane(msg) {
  pushConsole(`[coffilot] ${msg}`, "stderr", "run");
  lanes.run.phase = "failed";
  lanes.run.exitCode = -1;
  broadcast("status", statusSnapshot());
}

/** Two-phase pure-Java launch for non-Spring modules. Both phases run on the
 * independent Run lane so launching the app never blocks (or is blocked by) a
 * Build/Test on the shared build lane. The launch strategy degrades by capability:
 *   1. Gradle `application` plugin  -> `gradle :module:run` (resolves classpath +
 *      main class and forks the app JVM — the canonical generic launcher).
 *   2. An executable jar            -> `java -jar <jar>` (fat/shaded jars, or a jar
 *      whose manifest sets Main-Class).
 *   3. A configured main class      -> `java -cp <runtime classpath> <mainClass>`
 *      (Maven reconstructs the classpath via dependency:build-classpath; Gradle
 *      falls back to compiled classes + resources).
 * If none apply, the lane fails with actionable guidance. */
async function runPureJava({ module, mavenProfiles }) {
  app.runMode = "java";
  const mod = listModules().find((m) => m.name === (module || "")) || null;

  // 1. Gradle application plugin: `run` compiles and launches in one step.
  if (buildTool === "gradle" && mod && mod.application) {
    const r = resolveRunner(false);
    const task = gradleTaskPath(module, "run");
    pushConsole(`[coffilot] launching via the Gradle application plugin (${task}).`, "stdout", "run");
    spawnTool("run", [task, "--console=plain"], "running", {
      bin: r.bin,
      label: r.label,
      env: toolEnv(),
      onLine: detectPort,
    });
    return;
  }

  // Otherwise build, then resolve a jar / main class to launch.
  if (buildTool === "gradle") {
    const r = resolveRunner(false);
    const buildArgs = [gradleTaskPath(module, "build"), "-x", "test", "--console=plain"];
    const code = await spawnTool("run", buildArgs, "building", { bin: r.bin, label: r.label });
    if (code !== 0) return; // run lane already 'failed' -> "fix startup" path
  } else {
    const pkg = ["-ntp", "-Dmaven.test.skip=true"];
    if (module) pkg.push("-pl", module);
    if (mavenProfiles && mavenProfiles.trim()) pkg.push("-P", mavenProfiles.trim());
    pkg.push("package");
    const code = await spawnTool("run", pkg, "building", {});
    if (code !== 0) return; // run lane already 'failed' -> "fix startup" path
  }

  // 2. Prefer an executable jar (its manifest declares a Main-Class).
  const found = await findLaunchJar(module);
  if (found && found.mainClass) {
    spawnTool("run", [NATIVE_ACCESS_FLAG, "-jar", found.jar], "running", {
      bin: "java",
      label: "java",
      onLine: detectPort,
    });
    return;
  }

  // 3. No executable jar — launch a configured main class on a runtime classpath.
  const mainClass = mod && mod.mainClass;
  if (mainClass) {
    const cp = await runtimeClasspath(module, mavenProfiles);
    if (cp) {
      pushConsole(`[coffilot] launching ${mainClass} with java -cp.`, "stdout", "run");
      spawnTool("run", [NATIVE_ACCESS_FLAG, "-cp", cp, mainClass], "running", {
        bin: "java",
        label: "java",
        onLine: detectPort,
      });
      return;
    }
  }

  // 4. Last resort: a candidate jar exists but we couldn't confirm an executable
  //    manifest (and no main class was configured). Try `java -jar` anyway — it
  //    preserves the legacy behavior and may still carry a Main-Class we failed
  //    to read; the run lane surfaces a "fix startup" path if it doesn't.
  if (found && found.jar) {
    pushConsole(
      "[coffilot] no executable manifest or configured main class confirmed; attempting java -jar as a fallback.",
      "stdout",
      "run",
    );
    spawnTool("run", [NATIVE_ACCESS_FLAG, "-jar", found.jar], "running", {
      bin: "java",
      label: "java",
      onLine: detectPort,
    });
    return;
  }

  // 5. Nothing launchable.
  const dirLabel = buildTool === "gradle" ? "build/libs/" : "target/";
  const hint =
    buildTool === "gradle"
      ? "apply the Gradle `application` plugin (and set `mainClass`), or configure a `Main-Class` jar manifest"
      : "set a `<mainClass>` on the Maven Jar/Shade/Assembly plugin, or an `<exec.mainClass>` property";
  failRunLane(
    `no runnable .jar under ${dirLabel} and no main class is configured for this module — ${hint}, then Run again.`,
  );
}

/** Assemble a runtime classpath string for launching a module's main class.
 * Maven asks the dependency plugin for the resolved runtime dependencies and
 * prepends the module's compiled classes. Gradle (without the application plugin,
 * which would otherwise be used) can't resolve external dependencies cheaply, so
 * it falls back to the compiled classes + resources and warns. */
async function runtimeClasspath(module, mavenProfiles) {
  const moduleDir = path.join(workspacePath, module || "");
  if (buildTool === "gradle") {
    const classes = path.join(moduleDir, "build", "classes", "java", "main");
    const resources = path.join(moduleDir, "build", "resources", "main");
    pushConsole(
      "[coffilot] no application plugin detected; launching with compiled classes only — external dependencies may be missing. " +
        "Apply the Gradle `application` plugin for a complete runtime classpath.",
      "stderr",
      "run",
    );
    return [classes, resources].filter(existsSync).join(path.delimiter) || classes;
  }

  const cpFile = path.join(os.tmpdir(), `coffilot-cp-${process.pid}-${Date.now()}.txt`);
  const args = ["-ntp", "-q"];
  if (module) args.push("-pl", module);
  if (mavenProfiles && mavenProfiles.trim()) args.push("-P", mavenProfiles.trim());
  args.push("dependency:build-classpath", `-Dmdep.outputFile=${cpFile}`, "-Dmdep.includeScope=runtime");
  const code = await spawnTool("run", args, "building", {});
  let deps = "";
  try {
    deps = readFileSync(cpFile, "utf8").trim();
  } catch {
    /* no dependencies, or the plugin failed — fall back to classes only */
  }
  try {
    if (existsSync(cpFile)) unlinkSync(cpFile);
  } catch {
    /* best-effort cleanup */
  }
  if (code !== 0 && !deps) return null;
  const classes = path.join(moduleDir, "target", "classes");
  return deps ? classes + path.delimiter + deps : classes;
}

/** Pick a module's launch jar, preferring an executable one. Skips sources/javadoc
 * and Gradle's non-executable `-plain.jar`. Returns `{ jar, mainClass }` where
 * `mainClass` is the manifest's Main-Class (non-null only when the jar is
 * executable), or null when no candidate jar exists. */
async function findLaunchJar(module) {
  const sub = buildTool === "gradle" ? path.join("build", "libs") : "target";
  const dir = path.join(workspacePath, module || "", sub);
  let files;
  try {
    files = await readdir(dir);
  } catch {
    return null;
  }
  const jars = files.filter(
    (f) =>
      f.endsWith(".jar") && !f.endsWith("-sources.jar") && !f.endsWith("-javadoc.jar") && !f.endsWith("-plain.jar"),
  );
  if (!jars.length) return null;
  // Shortest name first (the classifier-less main artifact in most layouts), but an
  // executable jar (e.g. a shaded `-all.jar`) wins regardless of name length.
  jars.sort((a, b) => a.length - b.length);
  let fallback = null;
  for (const name of jars) {
    const full = path.join(dir, name);
    if (fallback === null) fallback = full;
    const mainClass = jarMainClass(full);
    if (mainClass) return { jar: full, mainClass };
  }
  return { jar: fallback, mainClass: null };
}

/** Read a jar's `Main-Class` manifest attribute, or null if it isn't executable
 * (or can't be read). A jar is a zip; this parses the central directory and
 * inflates only META-INF/MANIFEST.MF, so it needs no external tools. */
function jarMainClass(jarPath) {
  try {
    const manifest = readZipEntry(jarPath, "META-INF/MANIFEST.MF");
    if (!manifest) return null;
    // Manifests fold long values onto continuation lines that start with a space.
    const unfolded = manifest.toString("utf8").replace(/\r\n/g, "\n").replace(/\n /g, "");
    const m = unfolded.match(/^Main-Class:\s*(\S+)\s*$/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** Extract a single entry from a zip file by name, returning its bytes (or null).
 * Minimal reader: locate the End Of Central Directory record, walk the central
 * directory to the named entry, then read + inflate its local data. Handles the
 * stored (0) and deflate (8) methods, which cover every real jar manifest. */
function readZipEntry(zipPath, entryName) {
  const buf = readFileSync(zipPath);
  const EOCD_SIG = 0x06054b50;
  let eocd = -1;
  const minEocd = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= minEocd; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const cdCount = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < cdCount; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    if (name === entryName) {
      if (buf.readUInt32LE(localOff) !== 0x04034b50) return null;
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(dataStart, dataStart + compSize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data);
      return null;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
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
 * Stop one lane's process, the whole build group (op="maven" → build/test/
 * package), or all of them when `op` is omitted. The Run lane also tears down
 * metrics polling and live reload; the build lanes just kill the shared child.
 * Lanes are independent, so stopping the build group leaves Run running.
 * ("maven" names the group for back-compat; it applies to Gradle projects too.)
 */
function stopApp(op) {
  let targets;
  if (op === "maven" || op === "build-group") targets = ["build", "test", "package"];
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

// ---------------------------------------------------------------------------
// Process shutdown — never let a spawned Maven/Java process outlive us.
//
// The host stops the extension by terminating this Node process (SIGTERM, or
// SIGINT during a Ctrl-C). Our children are spawned *attached*, but on POSIX an
// attached child is NOT killed when its parent dies — it is reparented to
// init/launchd and keeps running, holding its HTTP port. Closing the canvas
// panel does not stop the app either (that is intentional; a panel can be
// reopened). So the only safe place to guarantee no orphans is here, on the way
// out: SIGTERM the whole lane group (which lets Spring Boot run its shutdown
// hook / the plugin kill its forked JVM) and tear down the polling timers.
let shuttingDown = false;
function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    session.log(`[coffilot] received ${signal}; stopping child processes`, { level: "info", ephemeral: true });
  } catch {
    /* host channel may already be gone */
  }
  stopApp(); // SIGTERM every lane + stop metrics polling / live reload timers
  // Don't block on killChild's 5s SIGKILL escalation; exit promptly. The "exit"
  // handler below force-kills anything still alive as a last resort.
  setTimeout(() => process.exit(0), 1500).unref();
}

process.once("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.once("SIGINT", () => gracefulShutdown("SIGINT"));

// Last-ditch synchronous sweep for any other exit path (process.exit elsewhere,
// a handled fatal error). Only synchronous work runs during "exit".
process.on("exit", () => {
  for (const o of ["build", "test", "package", "run"]) {
    const child = lanes[o].child;
    if (child && !child.killed) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }
});

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
 * Parse every JUnit TEST-*.xml (Maven Surefire/Failsafe and Gradle
 * build/test-results) into a structured report with per-method results.
 * {@code sinceMs} filters out stale reports left by earlier builds of other
 * modules so only the freshly-run module's results are reported.
 */
async function collectSurefireReport(sinceMs) {
  const report = {
    summary: { tests: 0, passed: 0, failures: 0, errors: 0, skipped: 0, timeSec: 0, files: 0 },
    suites: [],
  };
  const dirs = await findTestResultDirs(workspacePath, 0);
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

const SKIP_DIRS = new Set(["node_modules", ".git", ".m2", ".gradle", "src", "frontend"]);

// Collect every directory that may hold JUnit TEST-*.xml: Maven's
// target/surefire-reports + failsafe-reports, and Gradle's
// build/test-results/<task> subfolders.
async function findTestResultDirs(root, depth, acc = []) {
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
    if (e.name === "surefire-reports" || e.name === "failsafe-reports") {
      acc.push(full);
      continue;
    }
    if (e.name === "test-results") {
      // Gradle nests results one level deeper, per test task (test, integrationTest…).
      try {
        const subs = await readdir(full, { withFileTypes: true });
        for (const s of subs) if (s.isDirectory()) acc.push(path.join(full, s.name));
      } catch {
        /* ignore unreadable */
      }
      continue;
    }
    if (SKIP_DIRS.has(e.name)) continue;
    await findTestResultDirs(full, depth + 1, acc);
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
    /\[ERROR\]|BUILD FAILURE|BUILD FAILED|error:|Caused by:|Exception|cannot find symbol|incompatible types|APPLICATION FAILED TO START|Error creating bean|Port \d+ was already in use|FAILED/;
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
        `The ${TOOL_LABEL} build in this project failed to compile/package. Find the root cause and fix the code so the build passes.`,
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
        "The application failed to start as a non-Spring Java process (the generic runner: `gradle run`, `java -jar`, or `java -cp <classpath> <mainClass>`). Diagnose the startup failure (missing/incorrect main class, missing classpath entries or dependencies, uncaught exception, port already in use, etc.) and fix it.",
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
      if (buildTool === "gradle") {
        const { rel, kts } = gradleModuleBuildFile(moduleName);
        const dep = kts
          ? `developmentOnly("com.julien-dubois.bootui:bootui-spring-boot-starter:VERSION")`
          : `developmentOnly 'com.julien-dubois.bootui:bootui-spring-boot-starter:VERSION'`;
        return [
          "This is a Spring Boot application that does not yet depend on BootUI. Add the BootUI Spring Boot starter so its local developer console becomes available, scoped to dev-time only.",
          `Edit \`${rel}\` and add the starter to the \`developmentOnly\` configuration inside the \`dependencies { }\` block (the Spring Boot Gradle plugin puts \`developmentOnly\` dependencies on the \`bootRun\` classpath but keeps them out of the packaged jar):`,
          codeBlock(`dependencies {\n  ${dep}\n}`, kts ? "kotlin" : "groovy"),
          [
            "- If a `developmentOnly` line for this starter already exists, leave it; don't duplicate it.",
            "- Use the latest released version of `com.julien-dubois.bootui:bootui-spring-boot-starter` from Maven Central; pin a concrete version rather than a range (replace `VERSION`).",
          ].join("\n"),
          "When done, tell me the version you pinned and the command to launch with BootUI enabled (e.g. `./gradlew bootRun`, then open http://localhost:8080/bootui).",
        ]
          .filter(Boolean)
          .join("\n\n");
      }
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
      if (buildTool === "gradle") {
        const { rel, kts } = gradleModuleBuildFile(moduleName);
        const resDir = moduleName ? `${moduleName}/src/main/resources` : "src/main/resources";
        const dep = kts
          ? `developmentOnly("org.springframework.boot:spring-boot-devtools")`
          : `developmentOnly 'org.springframework.boot:spring-boot-devtools'`;
        return [
          "This is a Spring Boot application that doesn't yet use Spring Boot DevTools. Add DevTools (dev-time only) and turn on live reload so the app restarts automatically on code changes.",
          `1. Edit \`${rel}\` and add DevTools to the \`developmentOnly\` configuration inside \`dependencies { }\` (this keeps it off the packaged jar):`,
          codeBlock(`dependencies {\n  ${dep}\n}`, kts ? "kotlin" : "groovy"),
          "   Omit the version so it inherits from the Spring Boot plugin's dependency management. Don't duplicate the line if it's already present.",
          `2. In \`${resDir}/application.properties\` (create it if it doesn't exist), enable live reload:`,
          codeBlock("spring.devtools.restart.enabled=true\nspring.devtools.livereload.enabled=true", "properties"),
          "After editing, tell me to run with `./gradlew bootRun` — the canvas then recompiles on save so DevTools restarts the app.",
        ]
          .filter(Boolean)
          .join("\n\n");
      }
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
    case "install-jdtls": {
      const platformName = extra.os || (process.platform === "darwin" ? "macOS" : isWindows ? "Windows" : "Linux");
      const installCmd = extra.installCmd || "brew install jdtls";
      const minJava = extra.minJava || JDTLS_MIN_JAVA;
      const reason = extra.reason || "unknown";
      const javaVersion = extra.javaVersion || "not detected";
      const configFile = extra.configFile || "~/.copilot/lsp-config.json";
      const lspBlock = codeBlock(
        JSON.stringify(
          {
            lspServers: {
              java: {
                command: "jdtls",
                args: [
                  "--jvm-arg=-Xmx4G",
                  "--jvm-arg=-Dlog.level=WARN",
                  "--jvm-arg=-XX:+UseStringDeduplication",
                  "-data",
                  ".jdtls-workspace",
                ],
                fileExtensions: { ".java": "java" },
              },
            },
          },
          null,
          2,
        ),
        "json",
      );
      // Lead with the step that matches the detected gap so Copilot fixes the
      // right thing first, then include the rest for completeness.
      const lead =
        reason === "no-launcher"
          ? "The `jdtls` launcher isn't on the PATH, so the language server can't start."
          : reason === "old-jdk"
            ? `The active JDK (${javaVersion}) is older than Java ${minJava}, which JDTLS requires to run.`
            : reason === "no-config"
              ? "The Copilot CLI has no Java language-server entry, so it never launches JDTLS."
              : "JDTLS could not be confirmed as available.";
      return [
        `Java code intelligence (go-to-definition, find references, hover) isn't working in this Copilot CLI session because JDTLS — the Eclipse JDT Language Server — isn't available. ${lead} Please set it up for this environment (detected OS: ${platformName}).`,
        `1. Install the \`jdtls\` launcher if it isn't already on the PATH. On ${platformName} the usual one-liner is \`${installCmd}\`. Verify afterwards that \`which jdtls\` (or \`where jdtls\`) resolves.`,
        `2. Make sure a JDK ${minJava} or newer is installed and is what runs JDTLS — either set \`JAVA_HOME\` to it or put its \`java\` first on the PATH. (Detected runtime JDK: ${javaVersion}.)`,
        `3. Ensure the Copilot CLI is wired to use it: \`${configFile}\` must declare a \`java\` language server that maps \`.java\` files to the \`jdtls\` command, for example:`,
        lspBlock,
        "4. Reload the Copilot CLI extensions (or restart the session) so the language server is picked up, then re-open this canvas.",
        "When you're done, tell me which steps were needed and confirm that `jdtls` resolves on the PATH.",
      ]
        .filter(Boolean)
        .join("\n\n");
    }
    case "register-mcp": {
      const base = appBase();
      const mcpUrl = base ? `${base}/bootui/api/mcp` : "http://127.0.0.1:<app-port>/bootui/api/mcp";
      const cfg = JSON.stringify({ mcpServers: { bootui: { type: "http", url: mcpUrl } } }, null, 2);
      return [
        "Register this app's running BootUI MCP server with the GitHub Copilot CLI so its advisor scans (architecture, security, Spring, Hibernate, …) become callable as native MCP tools in this chat.",
        `The BootUI MCP server is exposed by the running app over Streamable HTTP (JSON-RPC) at \`${mcpUrl}\`.`,
        "Add it to the Copilot CLI MCP config (`~/.copilot/mcp-config.json`; create the file if it doesn't exist) under the `mcpServers` map, keyed as `bootui`:",
        codeBlock(cfg, "json"),
        [
          "- Merge into any existing `mcpServers` block rather than overwriting it; if a `bootui` entry already exists, update its `url` instead of duplicating it.",
          "- The URL points at the current run, so the app must stay up with its MCP server enabled for the tools to respond. If the app's port changes on a later run, update the `url`.",
          "- After saving, the Copilot CLI must pick up the new server: reload the MCP config (e.g. the `/mcp` command) or restart the CLI, then confirm the `bootui` tools are listed.",
        ].join("\n"),
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
  "/favicon.svg": { file: "favicon.svg", type: "image/svg+xml; charset=utf-8" },
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
      "Build, test, package and run a Maven or Gradle Java/Spring Boot app, watch live JVM metrics, run advisor scans, and push fixes back to the agent. Degrades gracefully by capability (plain Java → Spring Boot → Actuator → BootUI).",
    inputSchema: { type: "object", properties: {} },
    actions: [
      {
        name: "build_app",
        description:
          "Run a build with the project's build tool — Maven (default: ./mvnw -ntp -DskipTests install) or Gradle (default: ./gradlew build -x test). Waits for completion.",
        inputSchema: {
          type: "object",
          properties: {
            args: {
              type: "string",
              description: "Override the build-tool args, space-separated (e.g. '-pl core test' or ':web:build').",
            },
            mavenProfiles: {
              type: "string",
              description: "Maven build profiles to activate via -P (Maven projects only; ignored for Gradle).",
            },
            warm: {
              type: "boolean",
              description:
                "Keep the JVM warm between runs (Maven Daemon mvnd when available, or the Gradle daemon) for faster startup.",
            },
          },
        },
        handler: async (ctx) => build(splitArgs(ctx.input?.args), ctx.input?.warm === true, ctx.input?.mavenProfiles),
      },
      {
        name: "run_tests",
        description:
          "Run the project's tests — Maven (./mvnw -ntp test) or Gradle (./gradlew cleanTest test) — and return a parsed JUnit report (per-suite counts plus failure details).",
        inputSchema: {
          type: "object",
          properties: {
            args: {
              type: "string",
              description: "Override the build-tool args, space-separated (e.g. '-pl core test' or ':web:test').",
            },
            mavenProfiles: {
              type: "string",
              description: "Maven build profiles to activate via -P (Maven projects only; ignored for Gradle).",
            },
            warm: {
              type: "boolean",
              description:
                "Keep the JVM warm between runs (Maven Daemon mvnd when available, or the Gradle daemon) for faster startup.",
            },
          },
        },
        handler: async (ctx) => test(splitArgs(ctx.input?.args), ctx.input?.warm === true, ctx.input?.mavenProfiles),
      },
      {
        name: "package_app",
        description:
          "Build the deployable artifact(s) with the project's build tool — Maven (./mvnw -ntp package) or Gradle (./gradlew assemble). Waits for completion. Shares the build lane with build/test (serialized), independent of a running app.",
        inputSchema: {
          type: "object",
          properties: {
            args: {
              type: "string",
              description: "Override the build-tool args, space-separated (e.g. '-pl core -DskipTests package').",
            },
            mavenProfiles: {
              type: "string",
              description: "Maven build profiles to activate via -P (Maven projects only; ignored for Gradle).",
            },
            warm: {
              type: "boolean",
              description:
                "Keep the JVM warm between runs (Maven Daemon mvnd when available, or the Gradle daemon) for faster startup.",
            },
          },
        },
        handler: async (ctx) =>
          packageApp(splitArgs(ctx.input?.args), ctx.input?.warm === true, ctx.input?.mavenProfiles),
      },
      {
        name: "start_app",
        description:
          "Launch the app (returns immediately; output streams to the canvas). Spring Boot modules run via spring-boot:run (Maven) or bootRun (Gradle). Non-Spring modules use the generic runner: the Gradle application plugin's run task, else an executable jar via java -jar, else the configured main class via java -cp. Use the 'dev' profile so BootUI activates and live metrics become available.",
        inputSchema: {
          type: "object",
          properties: {
            module: { type: "string", description: "Module to run (Maven -pl / Gradle subproject, e.g. 'web')." },
            profiles: {
              type: "string",
              description: "Spring profiles to activate (default 'dev'); ignored for non-Spring runs.",
            },
            mavenProfiles: {
              type: "string",
              description: "Maven build profiles to activate via -P (Maven projects only; ignored for Gradle).",
            },
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
