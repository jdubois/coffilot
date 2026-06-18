const params = new URLSearchParams(location.search);
const instance = params.get("instance");
const token = params.get("token");
const qs = `instance=${encodeURIComponent(instance)}&token=${encodeURIComponent(token)}`;

const buildConsoleEl = document.getElementById("build-console");
const packageConsoleEl = document.getElementById("package-console");
const testConsoleEl = document.getElementById("test-console");
const runConsoleEl = document.getElementById("run-console");
const debugConsoleEl = document.getElementById("debug-console");
const consoles = {
  build: buildConsoleEl,
  package: packageConsoleEl,
  test: testConsoleEl,
  run: runConsoleEl,
  debug: debugConsoleEl,
};
// Which main tab is active, used as the fallback target for op-less lines.
let activeTab = "build";
// Last full status snapshot ({ build, test, package, run, reload }). The
// header reflects the active tab's lane; tab switches re-render from this
// stored snapshot without waiting for the next status event.
let statusSnap = null;
function consoleFor(op) {
  return consoles[op] || consoles[activeTab] || buildConsoleEl;
}
const phaseEl = document.getElementById("phase");
const cmdEl = document.getElementById("cmd");
const cmdCopied = document.getElementById("cmd-copied");
const exitEl = document.getElementById("exit");
const metricsEl = document.getElementById("metrics");
const testsEl = document.getElementById("tests");
const tabBadge = document.getElementById("tab-tests-badge");
const tabBuildBadge = document.getElementById("tab-build-badge");
const tabRunBadge = document.getElementById("tab-run-badge");
const tabPackageBadge = document.getElementById("tab-package-badge");
const fullbuildToggle = document.getElementById("fullbuild-toggle");
const fullbuildInput = document.getElementById("in-fullbuild");
const buildCleanInput = document.getElementById("in-build-clean");
const packageCleanInput = document.getElementById("in-package-clean");
const packageInstallInput = document.getElementById("in-package-install");
const continuousToggle = document.getElementById("continuous-toggle");
const continuousInput = document.getElementById("in-continuous");
const testSelectionEl = document.getElementById("test-selection");
const testFilterEl = document.getElementById("test-filter");
const testSearchEl = document.getElementById("test-search");
const failuresOnlyInput = document.getElementById("in-failures-only");
const warmToggle = document.getElementById("warm-toggle");
const warmInput = document.getElementById("in-warm");
const warmLabel = document.getElementById("warm-label");
const warmInfo = document.getElementById("warm-info");
const moduleSelect = document.getElementById("in-module");
const jdkSelect = document.getElementById("in-jdk");
const jdkInfo = document.getElementById("jdk-info");
const jdkBanner = document.getElementById("jdk-banner");
const jdkMsg = document.getElementById("jdk-msg");
const jdkCmd = document.getElementById("jdk-cmd");
const jdkCopied = document.getElementById("jdk-copied");
const jdkDocs = document.getElementById("jdk-docs");
const springInput = document.getElementById("in-profiles");
const springMenu = document.getElementById("spring-menu");
const lblProfiles = document.getElementById("lbl-profiles");
const mavenMenu = document.getElementById("maven-menu");
const mvnProfilesInput = document.getElementById("in-mvn-profiles");
const mvnProfilesLabel = document.getElementById("lbl-mvn-profiles");
const mvnProfilesCombo = document.getElementById("mvn-profiles-combo");
const noToolBanner = document.getElementById("no-tool-banner");
const btnRecheck = document.getElementById("btn-recheck");
const btnRefresh = document.getElementById("btn-refresh");
const btnUpdate = document.getElementById("btn-update");
const warmBanner = document.getElementById("warm-banner");
const warmMsg = document.getElementById("warm-msg");
const warmCmd = document.getElementById("warm-cmd");
const warmCopied = document.getElementById("warm-copied");
const warmDocs = document.getElementById("warm-docs");
const btnAddBootui = document.getElementById("btn-add-bootui");
const btnAddDevtools = document.getElementById("btn-add-devtools");
const setJdtls = document.getElementById("set-jdtls");
const jdtlsDot = document.getElementById("jdtls-dot");
const jdtlsStateEl = document.getElementById("jdtls-state");
const jdtlsInfoEl = document.getElementById("jdtls-info");
const btnSetupJdtls = document.getElementById("btn-setup-jdtls");
const jdtlsBanner = document.getElementById("jdtls-banner");
const jdtlsMsg = document.getElementById("jdtls-msg");
const jdtlsCmd = document.getElementById("jdtls-cmd");
const jdtlsCopied = document.getElementById("jdtls-copied");
const jdtlsDocs = document.getElementById("jdtls-docs");
const reloadPill = document.getElementById("reload-pill");
const setSpring = document.getElementById("set-spring");
const setDevtools = document.getElementById("set-devtools");
const devtoolsToggle = document.getElementById("devtools-toggle");
const devtoolsInput = document.getElementById("in-devtools");
const setRandomport = document.getElementById("set-randomport");
const randomportInput = document.getElementById("in-randomport");
const maskSecretsInput = document.getElementById("in-masksecrets");
const metricsPollInput = document.getElementById("in-metricspoll");
const openBrowserInput = document.getElementById("in-openbrowser");
const autoProfileInput = document.getElementById("in-autoprofile");
const btnOpenBrowser = document.getElementById("btn-open-browser");
const btnFix = document.getElementById("btn-fix");
const btnRun = document.getElementById("btn-run");
const btnDebug = document.getElementById("btn-debug");
// Debug-tab controls + state.
const dbgStateEl = document.getElementById("dbg-state");
const dbgLocEl = document.getElementById("dbg-loc");
const dbgSuspendInput = document.getElementById("in-dbg-suspend");
const btnDbgContinue = document.getElementById("btn-dbg-continue");
const btnDbgStepOver = document.getElementById("btn-dbg-stepover");
const btnDbgStepInto = document.getElementById("btn-dbg-stepinto");
const btnDbgStepOut = document.getElementById("btn-dbg-stepout");
const btnDbgPause = document.getElementById("btn-dbg-pause");
const bpClassInput = document.getElementById("in-bp-class");
const bpLineInput = document.getElementById("in-bp-line");
const btnBpAdd = document.getElementById("btn-bp-add");
const bpListEl = document.getElementById("bp-list");
const dbgStackEl = document.getElementById("dbg-stack");
const dbgVarsEl = document.getElementById("dbg-vars");
const dbgFrameLabel = document.getElementById("dbg-frame-label");
const dbgEvalInput = document.getElementById("in-dbg-eval");
const btnDbgEval = document.getElementById("btn-dbg-eval");
const dbgEvalResult = document.getElementById("dbg-eval-result");
const tabDebugBadge = document.getElementById("tab-debug-badge");
let debugSnap = null;
let dbgSelectedFrame = 0;
// Run-tab flame graph (async-profiler) controls.
const flameEvent = document.getElementById("flame-event");
const flameDuration = document.getElementById("flame-duration");
const btnProfile = document.getElementById("btn-profile");
const btnProfileStop = document.getElementById("btn-profile-stop");
const flameStatus = document.getElementById("flame-status");
const flameSearch = document.getElementById("flame-search");
const btnFlameReset = document.getElementById("btn-flame-reset");
const btnFlameFix = document.getElementById("btn-flame-fix");
const flameUnavailable = document.getElementById("flame-unavailable");
const flameMsg = document.getElementById("flame-msg");
const flameCmd = document.getElementById("flame-cmd");
const flameCopied = document.getElementById("flame-copied");
const flameDocs = document.getElementById("flame-docs");
const flameEmpty = document.getElementById("flame-empty");
const flameInfo = document.getElementById("flame-info");
const flameGraph = document.getElementById("flame-graph");
const flameHotspots = document.getElementById("flame-hotspots");
// Running spinners on each trigger button and tab. The Test tab keeps its
// badge/progress feedback too; the spinner shows only while the run is busy.
const btnSpin = {
  build: document.querySelector("#btn-build .btn-spin"),
  test: document.querySelector("#btn-test .btn-spin"),
  package: document.querySelector("#btn-package .btn-spin"),
  run: document.querySelector("#btn-run .btn-spin"),
  debug: document.querySelector("#btn-debug .btn-spin"),
};
const tabSpin = {
  build: document.querySelector('.tab[data-tab="build"] .tab-spin'),
  test: document.querySelector('.tab[data-tab="test"] .tab-spin'),
  package: document.querySelector('.tab[data-tab="package"] .tab-spin'),
  run: document.querySelector('.tab[data-tab="run"] .tab-spin'),
  debug: document.querySelector('.tab[data-tab="debug"] .tab-spin'),
};
// Build/Test/Package share one serialized Maven lane, so while one runs the
// others are greyed out until it's stopped.
const mvnButtons = {
  build: document.getElementById("btn-build"),
  test: document.getElementById("btn-test"),
  package: document.getElementById("btn-package"),
};
// While a lane is restarting, the trigger keeps its label (no width change) and
// shows a rotating restart glyph in the spinner slot; this maps op -> button so
// we can toggle that state class.
const triggerButton = {
  build: mvnButtons.build,
  test: mvnButtons.test,
  package: mvnButtons.package,
  run: btnRun,
  debug: btnDebug,
};
const capsEl = document.getElementById("caps");
const metricsSrc = document.getElementById("metrics-src");
const metricsHint = document.getElementById("metrics-hint");
const mcpToggle = document.getElementById("mcp-toggle");
const mcpToggleLabel = document.getElementById("mcp-toggle-label");
const mcpState = document.getElementById("mcp-state");
const mcpRegisterBtn = document.getElementById("mcp-register");
const quarkusMcpPanel = document.getElementById("quarkus-mcp");
const quarkusMcpState = document.getElementById("quarkus-mcp-state");
const quarkusMcpScansEl = document.getElementById("quarkus-mcp-scans");
const quarkusMcpRegisterBtn = document.getElementById("quarkus-mcp-register");
const scansSrc = document.getElementById("scans-src");
const scansHint = document.getElementById("scans-hint");
const scansListEl = document.getElementById("scans-list");
const scansResultEl = document.getElementById("scans-result");
let caps = {};
// Whether a Maven/Gradle build tool is present. When false the canvas runs
// in degraded mode: Build/Test/Package/Run stay disabled.
let toolPresent = true;
// Persisted "Full build" preference (env.settings.fullBuild), on by default.
// Tracked here so renderStatus can show the toggle unchecked while continuous
// testing overrides it, then restore the user's choice once continuous testing
// is turned off.
let fullBuildSetting = true;
// Last JDTLS availability snapshot (env.jdtls), used for the toolchain pill.
let jdtlsState = {};
// Last active-JDK snapshot (env.activeJdk): the JDK actually used to build/run.
let activeJdkInfo = null;

if (warmCmd) {
  warmCmd.onclick = async () => {
    try {
      await navigator.clipboard.writeText(warmCmd.textContent.trim());
      warmCopied.hidden = false;
      setTimeout(() => (warmCopied.hidden = true), 1500);
    } catch {
      // Clipboard may be unavailable in the sandbox; selecting is the fallback.
      const r = document.createRange();
      r.selectNodeContents(warmCmd);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }
  };
}

if (jdtlsCmd) {
  jdtlsCmd.onclick = async () => {
    try {
      await navigator.clipboard.writeText(jdtlsCmd.textContent.trim());
      jdtlsCopied.hidden = false;
      setTimeout(() => (jdtlsCopied.hidden = true), 1500);
    } catch {
      const r = document.createRange();
      r.selectNodeContents(jdtlsCmd);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }
  };
}

if (flameCmd) {
  flameCmd.onclick = async () => {
    try {
      await navigator.clipboard.writeText(flameCmd.textContent.trim());
      flameCopied.hidden = false;
      setTimeout(() => (flameCopied.hidden = true), 1500);
    } catch {
      const r = document.createRange();
      r.selectNodeContents(flameCmd);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }
  };
}

if (jdkCmd) {
  jdkCmd.onclick = async () => {
    try {
      await navigator.clipboard.writeText(jdkCmd.textContent.trim());
      jdkCopied.hidden = false;
      setTimeout(() => (jdkCopied.hidden = true), 1500);
    } catch {
      const r = document.createRange();
      r.selectNodeContents(jdkCmd);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }
  };
}

// Click the status command to copy the full (untruncated) command.
cmdEl.addEventListener("click", async () => {
  const text = cmdEl.dataset.copy;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const r = document.createRange();
    r.selectNodeContents(cmdEl);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }
  cmdCopied.hidden = false;
  clearTimeout(cmdEl._copyTimer);
  cmdEl._copyTimer = setTimeout(() => (cmdCopied.hidden = true), 1500);
});

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Main tabs (Build / Test / Package / Run)
function showTab(name) {
  if (!consoles[name]) return;
  activeTab = name;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  document.getElementById("build-pane").classList.toggle("active", name === "build");
  document.getElementById("package-pane").classList.toggle("active", name === "package");
  document.getElementById("test-pane").classList.toggle("active", name === "test");
  document.getElementById("run-pane").classList.toggle("active", name === "run");
  document.getElementById("debug-pane").classList.toggle("active", name === "debug");
  // The header (phase/command/exit/fix) follows the active tab, so
  // re-render it for the newly shown lane from the last status snapshot.
  if (statusSnap) renderLaneHeader(statusSnap[name] || {});
}
document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => showTab(t.dataset.tab)));

// Test tab: Graphical / Console sub-toggle (graphical is the default).
function showTestView(view) {
  document
    .querySelectorAll(".subtab[data-tview]")
    .forEach((t) => t.classList.toggle("active", t.dataset.tview === view));
  document.getElementById("tests").classList.toggle("active", view === "graphical");
  document.getElementById("test-console").classList.toggle("active", view === "console");
}
document.querySelectorAll(".subtab[data-tview]").forEach((t) => (t.onclick = () => showTestView(t.dataset.tview)));

// Run tab: Console / Flame graph sub-toggle (console is the default).
function showRunView(view) {
  document
    .querySelectorAll(".subtab[data-rview]")
    .forEach((t) => t.classList.toggle("active", t.dataset.rview === view));
  document.getElementById("run-console-view").classList.toggle("active", view === "console");
  document.getElementById("run-flame").classList.toggle("active", view === "flame");
}
document.querySelectorAll(".subtab[data-rview]").forEach((t) => (t.onclick = () => showRunView(t.dataset.rview)));

// Aside tool panels (Live JVM Metrics / Loggers / Scans / Settings) live in an
// always-present IntelliJ-style vertical bar on the right edge. Each panel is
// minimized by default; clicking a bar button opens that one panel docked beside
// the bar, and only one is ever open at a time. #workspace.aside-rail = the
// vertical bar is rendered (always on); #workspace.aside-open = a panel body is
// docked open beside it. See styles.css for the matching presentation.
const workspaceEl = document.getElementById("workspace");
const asideToggle = document.getElementById("aside-toggle");
const asideDrawer = window.matchMedia("(max-width: 819px)");

// Persisted right-panel preference (settings.asideTab / settings.asideOpen),
// restored from the server on the first env load. asideTabPref is the last-opened
// tab; asideOpenPref is whether the panel is expanded beside the bar. The
// narrow-canvas overlay is transient and never updates asideOpenPref. Defaults
// minimized so the panel starts as just the vertical bar the first time the canvas
// is opened, then remembers whatever the user last did.
let asideTabPref = "settings";
let asideOpenPref = false;
let asideStateApplied = false;

function activeAsideTab() {
  const t = document.querySelector(".atab.active");
  return t ? t.dataset.atab : null;
}
function syncLoggersPolling() {
  if (loggersTabActive()) startLoggersPolling();
  else stopLoggersPolling();
}
// The tool panels always live in the vertical bar; only the open/closed state of
// a panel body changes. Keep aside-rail on at all widths.
function syncAsideMode() {
  const open = workspaceEl.classList.contains("aside-open");
  workspaceEl.classList.add("aside-rail");
  if (asideToggle) {
    asideToggle.setAttribute("aria-label", open ? "Hide panel" : "Show panel");
    asideToggle.title = open ? "Hide panel" : "Show panel";
  }
}
function setAsideOpen(open) {
  workspaceEl.classList.toggle("aside-open", open);
  syncAsideMode();
  syncLoggersPolling();
}
function showAsideTab(name) {
  document.querySelectorAll(".atab").forEach((t) => t.classList.toggle("active", t.dataset.atab === name));
  document.getElementById("atab-metrics").classList.toggle("active", name === "metrics");
  document.getElementById("atab-loggers").classList.toggle("active", name === "loggers");
  document.getElementById("atab-scans").classList.toggle("active", name === "scans");
  document.getElementById("atab-settings").classList.toggle("active", name === "settings");
  syncLoggersPolling();
  syncAsideWide();
}
// BootUI scan reports can be wide (severity badges + expandable findings), so the
// aside grows to a roomier width while scan results are on screen and snaps back
// to its slim default on any other tab. The default stays the minimal width.
let hasScanResults = false;
function syncAsideWide() {
  workspaceEl.classList.toggle("aside-wide", activeAsideTab() === "scans" && hasScanResults);
}
function markScanResults(on) {
  hasScanResults = on;
  syncAsideWide();
}
// Capture the current panel state as the persisted preference and save it. The
// open/closed half is only meaningful for the docked (wide) layout — the narrow
// overlay collapses transiently — so only update asideOpenPref when wide.
function rememberAsideState() {
  asideTabPref = activeAsideTab() || "settings";
  if (!asideDrawer.matches) asideOpenPref = workspaceEl.classList.contains("aside-open");
  saveSettings();
}
// Restore the persisted panel preference once the settings land. Runs a single
// time so later env refreshes don't clobber live interaction.
function applyAsideState(s) {
  if (asideStateApplied || !s) return;
  asideStateApplied = true;
  asideTabPref = ["metrics", "loggers", "scans", "settings"].includes(s.asideTab) ? s.asideTab : "settings";
  asideOpenPref = s.asideOpen === true;
  showAsideTab(asideTabPref);
  // The remembered open state applies to the in-flow layout only; on a narrow
  // canvas the overlay stays collapsed until the user opens it.
  if (!asideDrawer.matches) setAsideOpen(asideOpenPref);
}
// Tab click: when collapsed, open the panel to that pane; when already expanded,
// switch panes, or collapse if you re-tap the pane that's already showing.
function onAsideTabClick(name) {
  if (!workspaceEl.classList.contains("aside-open")) {
    showAsideTab(name);
    setAsideOpen(true);
    rememberAsideState();
    return;
  }
  if (activeAsideTab() === name) {
    setAsideOpen(false);
    rememberAsideState();
    return;
  }
  showAsideTab(name);
  rememberAsideState();
}
document.querySelectorAll(".atab").forEach((t) => (t.onclick = () => onAsideTabClick(t.dataset.atab)));
if (asideToggle)
  asideToggle.onclick = () => {
    setAsideOpen(!workspaceEl.classList.contains("aside-open"));
    rememberAsideState();
  };
// Esc closes the open tool panel (any width), unless focus is in one of its
// fields (e.g. the profiles combo), which gets its own Escape.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !workspaceEl.classList.contains("aside-open")) return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
  setAsideOpen(false);
});
// Crossing the breakpoint keeps the always-on bar; restore the remembered open
// state when wide and collapse the overlay when narrow. Neither transition is
// persisted (it's layout-driven, not a user choice).
asideDrawer.addEventListener("change", () => setAsideOpen(asideDrawer.matches ? false : asideOpenPref));
// Initial state: start minimized at every width — the panels open on demand from
// the vertical bar. No loggers sync here (it would touch state declared later in
// this module); polling is driven by tab activation, so it stays off until a panel
// is opened. The persisted preference is applied later by applyAsideState once the
// settings land.
workspaceEl.classList.remove("aside-open");
syncAsideMode();

// Tool-panel availability. Settings is always usable; the others need a running
// app with the right capability (see updateAsideAvailability callers). Available
// panels sort to the top of the bar and unavailable ones sink below, but within
// each group the tabs keep a fixed canonical order (ASIDE_ORDER) so they never
// shuffle relative to one another. Clicking a greyed tab still opens it so its
// in-panel text explains what's missing.
const ASIDE_ALWAYS = new Set(["settings"]);
// Canonical left-to-right order, applied within both the available and the
// unavailable group. Settings always leads the available group (it's never
// unavailable); "quarkus" reserves the trailing slot for a future Quarkus tab.
const ASIDE_ORDER = ["settings", "metrics", "loggers", "scans", "quarkus"];
const ASIDE_REASON = {
  metrics:
    "Live JVM metrics need a running app that exposes metrics — Spring Boot Actuator/BootUI or Quarkus Micrometer. Click to learn more.",
  loggers: "Live log levels need a running Spring Boot app with the Actuator /loggers endpoint. Click to learn more.",
  scans: "The BootUI panel needs a running BootUI app — Run a module with the BootUI starter. Click to learn more.",
};
// metrics / loggers / scans are each gated on the running app exposing the right
// capability (see updateAsideAvailability callers); the BootUI (scans) tab is
// available only while a BootUI app is actually up, exactly like the other two.
function updateAsideAvailability(avail) {
  let anyUnavailable = false;
  document.querySelectorAll(".atab").forEach((btn) => {
    const name = btn.dataset.atab;
    const ok = ASIDE_ALWAYS.has(name) || !!(avail && avail[name]);
    if (!ok) anyUnavailable = true;
    btn.classList.toggle("unavailable", !ok);
    btn.setAttribute("aria-disabled", ok ? "false" : "true");
    // Available group sorts before the unavailable group; the canonical index
    // fixes the order within each group regardless of DOM order. The separator
    // (.atab-sep, order 50) sits between the two ranges.
    const rank = ASIDE_ORDER.indexOf(name);
    btn.style.order = String((ok ? 0 : 100) + (rank === -1 ? ASIDE_ORDER.length : rank));
    if (!btn.dataset.titleAvail) btn.dataset.titleAvail = btn.getAttribute("title") || "";
    btn.title = ok ? btn.dataset.titleAvail : ASIDE_REASON[name] || btn.dataset.titleAvail;
  });
  // The divider only makes sense when there's actually a disabled group below it.
  const sep = document.querySelector(".atab-sep");
  if (sep) sep.hidden = !anyUnavailable;
}
// Nothing is reachable until the first metrics snapshot lands, so start with only
// Settings enabled (renderMetrics refines this on every push).
updateAsideAvailability(null);

// Floating tooltip controller for [data-tip] elements (the settings info
// icons). Native title tooltips don't render reliably in the canvas
// webview, so we draw our own body-anchored bubble on hover/focus.
const tipPop = document.createElement("div");
tipPop.className = "tip-pop";
document.body.appendChild(tipPop);
let tipTarget = null;
function placeTip(el) {
  const text = el.getAttribute("data-tip");
  if (!text) return;
  tipTarget = el;
  tipPop.textContent = text;
  const r = el.getBoundingClientRect();
  const pop = tipPop.getBoundingClientRect();
  let left = r.left + r.width / 2 - pop.width / 2;
  left = Math.max(6, Math.min(left, window.innerWidth - pop.width - 6));
  let top = r.bottom + 6;
  if (top + pop.height > window.innerHeight - 6) top = r.top - pop.height - 6;
  tipPop.style.left = left + "px";
  tipPop.style.top = top + "px";
  tipPop.classList.add("show");
}
function hideTip() {
  tipTarget = null;
  tipPop.classList.remove("show");
}
document.addEventListener("mouseover", (e) => {
  const el = e.target.closest && e.target.closest("[data-tip]");
  if (el && el !== tipTarget) placeTip(el);
});
document.addEventListener("mouseout", (e) => {
  const el = e.target.closest && e.target.closest("[data-tip]");
  if (el && (!e.relatedTarget || !el.contains(e.relatedTarget))) hideTip();
});
document.addEventListener("focusin", (e) => {
  const el = e.target.closest && e.target.closest("[data-tip]");
  if (el) placeTip(el);
});
document.addEventListener("focusout", hideTip);

function appendLine(line, stream, op) {
  const el = consoleFor(op);
  const span = document.createElement("span");
  let cls = stream === "stderr" ? "err" : "";
  if (el === runConsoleEl) {
    // Tag each run-console line with a severity (continuation/stack-trace lines
    // inherit the previous line's level) so the log filter and per-level coloring
    // can work without re-parsing.
    let level = parseLogLevel(line);
    if (level) lastRunLevel = level;
    else level = lastRunLevel;
    span.dataset.level = level;
    span.dataset.text = line.toLowerCase();
    cls = (cls ? cls + " " : "") + "lvl-" + level.toLowerCase();
    if (!lineMatchesLogFilter(level, span.dataset.text)) span.hidden = true;
  }
  if (cls) span.className = cls;
  span.textContent = line + "\n";
  el.appendChild(span);
  while (el.childNodes.length > 2000) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
  if (el === runConsoleEl) updateLogCount();
}

// ---- Run console log filtering -----------------------------------------
// The Run console is the app's live log. A minimum-severity select and a text
// search filter it client-side; nothing leaves the iframe.
const logLevelSelect = document.getElementById("in-log-level");
const logSearchInput = document.getElementById("in-log-search");
const logCountEl = document.getElementById("log-count");
const LOG_RANK = { TRACE: 0, DEBUG: 1, INFO: 2, WARN: 3, ERROR: 4 };
let runMinLevel = ""; // "" = show all severities
let runSearch = "";
let lastRunLevel = "INFO"; // inherited level for lines without their own

function parseLogLevel(line) {
  const m = line.match(/\b(TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|SEVERE|FATAL)\b/);
  if (!m) return null;
  const t = m[1];
  if (t === "WARNING") return "WARN";
  if (t === "SEVERE" || t === "FATAL") return "ERROR";
  return t;
}

function lineMatchesLogFilter(level, lowerText) {
  if (runMinLevel && (LOG_RANK[level] ?? 2) < LOG_RANK[runMinLevel]) return false;
  if (runSearch && !lowerText.includes(runSearch)) return false;
  return true;
}

function applyLogFilter() {
  runMinLevel = logLevelSelect ? logLevelSelect.value : "";
  runSearch = logSearchInput ? logSearchInput.value.trim().toLowerCase() : "";
  for (const span of runConsoleEl.childNodes) {
    if (span.nodeType !== 1) continue;
    span.hidden = !lineMatchesLogFilter(span.dataset.level || "INFO", span.dataset.text || "");
  }
  updateLogCount();
}

function updateLogCount() {
  if (!logCountEl) return;
  if (!runMinLevel && !runSearch) {
    logCountEl.textContent = "";
    return;
  }
  const spans = runConsoleEl.querySelectorAll("span");
  let shown = 0;
  spans.forEach((s) => {
    if (!s.hidden) shown++;
  });
  logCountEl.textContent = spans.length ? `showing ${shown} / ${spans.length}` : "";
}

if (logLevelSelect) logLevelSelect.addEventListener("change", applyLogFilter);
if (logSearchInput) logSearchInput.addEventListener("input", applyLogFilter);

// Last status snapshot ({ build, test, package, run, reload }).
// (declared above, near activeTab, so showTab can read it)

// Optimistic "stopping" state for the two grouped Stop buttons. A stop request
// is fire-and-forget, and the lane only reports !busy once the child process
// actually dies (which can take a few seconds for a server). Without local
// feedback the button looks dead, so we flip it to a disabled "Stopping…"
// spinner the moment it's clicked and clear it when the lane goes idle (or a
// safety timeout fires, in case the process ignores the stop and the user
// needs to retry).
const stopping = { maven: false, run: false, debug: false };
const stopTimers = { maven: null, run: null, debug: null };

function markStopping(which, op) {
  if (stopping[which]) return;
  stopping[which] = true;
  const what = which === "debug" ? "the debugger" : which === "run" ? "the app" : "the build";
  appendLine(`[canvas] stopping ${what}\u2026`, "stdout", op);
  if (statusSnap) renderStatus(statusSnap);
  clearTimeout(stopTimers[which]);
  stopTimers[which] = setTimeout(() => {
    if (!stopping[which]) return;
    stopping[which] = false;
    if (statusSnap) renderStatus(statusSnap);
  }, 8000);
}

function clearStopping(which) {
  stopping[which] = false;
  clearTimeout(stopTimers[which]);
  stopTimers[which] = null;
}

// Each lane's primary button doubles as Build/Test/Package/Run/Debug (idle) and
// Stop (while that lane is busy), so there's exactly one action per lane.
const laneLabel = { build: "Build", test: "Run tests", package: "Package", run: "Run", debug: "Debug" };
function setLaneButton(op, { label, danger, disabled, busyState, title }) {
  const btn = triggerButton[op];
  if (!btn) return;
  const lbl = btn.querySelector(".btn-label");
  if (lbl) lbl.textContent = label;
  btn.classList.toggle("danger", !!danger);
  btn.classList.toggle("primary", !danger);
  btn.classList.toggle("is-stopping", busyState === "stopping");
  btn.disabled = !!disabled;
  btn.title = title || "";
}

// Optimistic "restarting" state for the trigger buttons. Clicking a trigger
// while its lane is busy stops the running process and relaunches it; the lane
// briefly reports idle/failed between the two, so we mask that transition until
// the new run reports busy. Two phases: "stopping" (waiting for the old process
// to exit) flips to "starting" the first time the lane reports not-busy, then
// clears once the relaunch reports busy. A safety timeout is the backstop in
// case the restart never starts (e.g. it timed out server-side).
const restarting = { build: false, test: false, package: false, run: false, debug: false };
const restartTimers = { build: null, test: null, package: null, run: null, debug: null };

function markRestarting(op) {
  if (restarting[op]) return;
  restarting[op] = "stopping";
  appendLine("[canvas] restarting\u2026", "stdout", op);
  clearTimeout(restartTimers[op]);
  // Backstop: if the relaunch never reports busy again (e.g. the server-side
  // restart timed out or failed), clear the mask and re-render so the trigger
  // doesn't stay stuck disabled/"Restarting…" — mirrors the Stop backstop.
  restartTimers[op] = setTimeout(() => {
    if (!restarting[op]) return;
    clearRestarting(op);
    if (statusSnap) renderStatus(statusSnap);
  }, 20000);
}

function clearRestarting(op) {
  restarting[op] = false;
  clearTimeout(restartTimers[op]);
  restartTimers[op] = null;
}

// Advance the restart state machine from the raw (server-reported) busy flags,
// so the mask drops exactly when the relaunched process is up.
function syncRestarting(s) {
  for (const op of ["build", "test", "package", "run", "debug"]) {
    const busy = !!(s[op] && s[op].busy);
    if (restarting[op] === "stopping" && !busy) restarting[op] = "starting";
    else if (restarting[op] === "starting" && busy) clearRestarting(op);
  }
}

// True while the lane is genuinely busy OR mid-restart, so the toolbar stays
// stable (siblings disabled, Stop active, spinner on) across the brief gap.
function laneActive(s, op) {
  return !!(s && s[op] && s[op].busy) || !!restarting[op];
}

// Raw server-reported busy for one lane (no restart masking) — used to decide
// whether a trigger click should start the lane or restart it.
const laneBusy = (op) => !!(statusSnap && statusSnap[op] && statusSnap[op].busy);

function renderStatus(s) {
  if (!s) return;
  statusSnap = s;
  // Advance any in-flight restart before rendering so the toolbar uses the
  // masked "active" state across the stop→start gap.
  syncRestarting(s);
  // Live reload pill is global, not per-tab.
  const reload = s.reload;
  if (reload && reload.active) {
    reloadPill.hidden = false;
    reloadPill.textContent = reload.busy ? "recompiling\u2026" : "live reload";
    reloadPill.className = "pill " + (reload.busy ? "running" : "idle");
  } else {
    reloadPill.hidden = true;
  }
  // Run-tab "Open in browser" button always tracks the run lane.
  const run = s.run || {};
  btnOpenBrowser.disabled = !run.appPort;
  btnOpenBrowser.title = run.appPort
    ? `Open http://127.0.0.1:${run.appPort} in your browser`
    : "The app isn't running yet";
  // The flame-graph Record button needs both async-profiler installed and the
  // app actually running (the run lane busy).
  runActive = !!(run.busy || run.appPort);
  updateProfileButton();
  // Drop the optimistic "stopping" state once the process has actually exited.
  const mvnBusy = laneActive(s, "build") || laneActive(s, "test") || laneActive(s, "package");
  if (stopping.run && !laneActive(s, "run")) clearStopping("run");
  if (stopping.debug && !laneActive(s, "debug")) clearStopping("debug");
  if (stopping.maven && !mvnBusy) clearStopping("maven");
  // Per-lane spinners on the trigger buttons and tabs (global, so they reflect
  // activity regardless of which tab is showing). The `is-restarting` class
  // turns the trigger's spinner into a rotating restart glyph without touching
  // the label, so the button keeps its width.
  for (const op of ["build", "test", "package", "run", "debug"]) {
    const active = laneActive(s, op);
    if (btnSpin[op]) btnSpin[op].hidden = !active;
    if (tabSpin[op]) tabSpin[op].hidden = !active;
    if (triggerButton[op]) {
      triggerButton[op].classList.toggle("is-restarting", !!restarting[op]);
    }
  }
  // Each lane's primary button: it triggers the lane when idle and becomes a red
  // Stop while that lane is busy. Build/Test/Package share one serialized Maven
  // lane, so while one runs its siblings are greyed out until it stops.
  const busyMvnOp = ["build", "test", "package"].find((op) => laneActive(s, op));
  for (const op of ["build", "test", "package"]) {
    if (!toolPresent) {
      setLaneButton(op, { label: laneLabel[op], disabled: true, title: "Coffilot needs a Maven or Gradle project." });
    } else if (op === busyMvnOp) {
      const isStopping = stopping.maven;
      setLaneButton(op, {
        label: isStopping ? "Stopping\u2026" : "Stop",
        danger: true,
        disabled: isStopping,
        busyState: isStopping ? "stopping" : "stop",
        title: isStopping ? "Stopping the build\u2026" : `Stop the running ${op}`,
      });
    } else if (busyMvnOp) {
      setLaneButton(op, { label: laneLabel[op], disabled: true, title: `Stop the running ${busyMvnOp} first` });
    } else {
      setLaneButton(op, { label: laneLabel[op], disabled: !!restarting[op] });
    }
  }
  // Run and Debug share the single app slot, so they're mutually exclusive: each
  // trigger restarts its own lane but is locked out while the other owns the app.
  const runLaneActive = laneActive(s, "run");
  const debugLaneActive = laneActive(s, "debug");
  // Build tab badge: a red compile-error count when the Build (compile) lane fails,
  // else a plain "!". Hidden while the lane is active/restarting.
  const buildLane = s.build || {};
  const buildCompileErrs = buildLane.compileErrors || 0;
  if (buildLane.phase === "failed" && !laneActive(s, "build")) {
    tabBuildBadge.hidden = false;
    tabBuildBadge.textContent = buildCompileErrs > 0 ? String(buildCompileErrs) : "!";
    tabBuildBadge.className = "badge bad";
    tabBuildBadge.title =
      buildCompileErrs > 0
        ? buildCompileErrs + " compilation error" + (buildCompileErrs === 1 ? "" : "s")
        : "Build failed \u2014 check the console or click Fix with Copilot.";
  } else {
    tabBuildBadge.hidden = true;
  }
  // Run tab badge: a red warning when a Run fails (the app never started — a compile
  // error or a startup crash, since a clean stop leaves phase "stopped"). Shows the
  // compile-error count when we could parse one, else a plain "!" like the other
  // tabs. Hidden while the lane is active/restarting — except for a Quarkus dev-mode
  // build failure, where the process keeps running (the lane stays active) but the
  // build is broken, so we badge it anyway.
  const runCompileErrs = run.compileErrors || 0;
  if (run.buildFailed) {
    tabRunBadge.hidden = false;
    tabRunBadge.textContent = "!";
    tabRunBadge.className = "badge bad";
    tabRunBadge.title = "Quarkus build failed \u2014 check the console or click Fix with Copilot.";
  } else if (run.phase === "failed" && !runLaneActive) {
    tabRunBadge.hidden = false;
    tabRunBadge.textContent = runCompileErrs > 0 ? String(runCompileErrs) : "!";
    tabRunBadge.className = "badge bad";
    tabRunBadge.title =
      runCompileErrs > 0
        ? runCompileErrs + " compilation error" + (runCompileErrs === 1 ? "" : "s")
        : "Run failed \u2014 check the console or click Fix with Copilot.";
  } else {
    tabRunBadge.hidden = true;
  }
  // Package tab badge: a red warning when packaging fails (mirrors the other tabs'
  // failure badges). Hidden while the lane is active/restarting.
  if ((s.package || {}).phase === "failed" && !laneActive(s, "package")) {
    tabPackageBadge.hidden = false;
    tabPackageBadge.textContent = "!";
    tabPackageBadge.className = "badge bad";
    tabPackageBadge.title = "Packaging failed \u2014 check the console or click Fix with Copilot.";
  } else {
    tabPackageBadge.hidden = true;
  }
  if (!toolPresent) {
    setLaneButton("run", { label: laneLabel.run, disabled: true, title: "Coffilot needs a Maven or Gradle project." });
  } else if (runLaneActive) {
    const isStopping = stopping.run;
    setLaneButton("run", {
      label: isStopping ? "Stopping\u2026" : "Stop",
      danger: true,
      disabled: isStopping,
      busyState: isStopping ? "stopping" : "stop",
      title: isStopping ? "Stopping the app\u2026" : "Stop the running app",
    });
  } else {
    setLaneButton("run", {
      label: laneLabel.run,
      disabled: !!restarting.run || debugLaneActive,
      title: debugLaneActive ? "Stop the debugger first" : "",
    });
  }
  if (!toolPresent) {
    setLaneButton("debug", {
      label: laneLabel.debug,
      disabled: true,
      title: "Coffilot needs a Maven or Gradle project.",
    });
  } else if (debugLaneActive) {
    const isStopping = stopping.debug;
    setLaneButton("debug", {
      label: isStopping ? "Stopping\u2026" : "Stop",
      danger: true,
      disabled: isStopping,
      busyState: isStopping ? "stopping" : "stop",
      title: isStopping ? "Stopping the debugger\u2026" : "Stop the debug session",
    });
  } else {
    setLaneButton("debug", {
      label: laneLabel.debug,
      disabled: !!restarting.debug || runLaneActive,
      title: runLaneActive ? "Stop the running app first" : "",
    });
  }
  // Test-view toggles (Full build / Continuous testing) reflect server state.
  reflectTestToggles();
  renderDebug(debugSnap, s);
  // Header (phase / command / exit / fix) follows the active tab; while the
  // active tab's lane is restarting, show a steady "restarting" phase instead of
  // the momentary failed/idle flicker (and no stale Fix button).
  const activeLane = s[activeTab] || {};
  if (restarting[activeTab]) {
    renderLaneHeader({ phase: "restarting", command: activeLane.command });
  } else {
    renderLaneHeader(activeLane);
  }
}

// Render the per-lane header bits for one op (build | test | package | run).
function renderLaneHeader(l) {
  const phase = l.phase || "idle";
  phaseEl.textContent = phase;
  phaseEl.className = "pill " + phase;
  cmdEl.textContent = l.command || "No command run yet.";
  // Long commands are truncated with an ellipsis; keep the full text for
  // the hover tooltip and click-to-copy.
  if (l.command) {
    cmdEl.dataset.tip = l.command;
    cmdEl.dataset.copy = l.command;
    cmdEl.classList.add("clickable");
  } else {
    delete cmdEl.dataset.tip;
    delete cmdEl.dataset.copy;
    cmdEl.classList.remove("clickable");
  }
  if (l.exitCode === null || l.exitCode === undefined) {
    exitEl.textContent = "";
  } else {
    exitEl.textContent = l.exitCode === 0 ? "\u2713 exit 0" : "\u2717 exit " + l.exitCode;
    exitEl.style.color = l.exitCode === 0 ? "var(--true-color-green, #1a7f37)" : "var(--true-color-red, #cf222e)";
  }
  // Contextual "Fix with Copilot" button, driven by the backend's fixInfo().
  if (l.fix && l.fix.kind) {
    const wasHidden = btnFix.hidden;
    btnFix.hidden = false;
    btnFix.disabled = false;
    btnFix.dataset.kind = l.fix.kind;
    btnFix.textContent = l.fix.label || "Fix with Copilot";
    // When the button first appears (e.g. a build flips to "failed"), replay a
    // one-shot pop. The animation forces the WKWebView to repaint the header so
    // the button is actually painted, instead of staying invisible until a tab
    // switch triggers the next layout pass. Removing + reflowing + re-adding the
    // class restarts the animation each time it re-appears.
    if (wasHidden) {
      btnFix.classList.remove("cof-pop-in");
      void btnFix.offsetWidth;
      btnFix.classList.add("cof-pop-in");
    }
  } else {
    btnFix.hidden = true;
    btnFix.classList.remove("cof-pop-in");
    btnFix.dataset.kind = "";
  }
}

function mb(bytes) {
  return bytes == null ? "?" : Math.round(bytes / 1048576) + " MB";
}
function row(k, v) {
  return `<div class="metric"><span class="k">${k}</span><span class="v">${v}</span></div>`;
}

// --- Debug lane rendering ----------------------------------------------------
// Class-name tail (com.example.Foo$Bar -> Foo$Bar) for compact display; the full
// binary name is kept in the title attribute.
function shortClass(name) {
  if (!name) return "";
  const i = name.lastIndexOf(".");
  return i === -1 ? name : name.slice(i + 1);
}

// Tracks the "paused at" identity so we only refetch locals when the stop point
// (or the selected frame) actually changes, not on every SSE debug push.
let dbgPausedKey = null;

function renderDebug(d, s) {
  d = d || debugSnap || {};
  const attached = !!d.active;
  const paused = !!d.paused;
  const debugBusy = !!(d.laneBusy || (s && s.debug && s.debug.busy));

  let state = "not started";
  let cls = "idle";
  if (d.attaching) {
    state = "connecting\u2026";
    cls = "running";
  } else if (paused) {
    state = "paused";
    cls = "paused";
  } else if (attached) {
    state = "running";
    cls = "running";
  } else if (debugBusy) {
    state = "launching\u2026";
    cls = "running";
  }
  dbgStateEl.textContent = state;
  dbgStateEl.className = "pill " + cls;

  const loc = d.location;
  dbgLocEl.textContent = loc ? `${shortClass(loc.class)}.${loc.method}:${loc.line}` : "";
  dbgLocEl.title = loc ? `${loc.class}.${loc.method}:${loc.line}` : "";

  // Stepping/continue only make sense while paused; pause only while running.
  btnDbgContinue.disabled = !paused;
  btnDbgStepOver.disabled = !paused;
  btnDbgStepInto.disabled = !paused;
  btnDbgStepOut.disabled = !paused;
  btnDbgPause.disabled = !attached || paused;
  dbgEvalInput.disabled = !paused;
  btnDbgEval.disabled = !paused;

  renderBreakpoints(d.breakpoints || []);
  renderStack(d.frames || [], paused);

  if (paused) {
    const key = `${loc ? loc.class : ""}:${loc ? loc.line : ""}:${dbgSelectedFrame}`;
    if (key !== dbgPausedKey) {
      dbgPausedKey = key;
      refreshVars();
    }
  } else {
    dbgPausedKey = null;
    dbgSelectedFrame = 0;
    dbgFrameLabel.textContent = "";
    dbgVarsEl.innerHTML = `<li class="empty">Variables appear while paused at a breakpoint.</li>`;
  }

  const bpN = (d.breakpoints || []).length;
  if (paused) {
    tabDebugBadge.hidden = false;
    tabDebugBadge.textContent = "\u25cf";
    tabDebugBadge.className = "badge paused";
    tabDebugBadge.title = "Paused at a breakpoint";
  } else if (bpN) {
    tabDebugBadge.hidden = false;
    tabDebugBadge.textContent = String(bpN);
    tabDebugBadge.className = "badge";
    tabDebugBadge.title = `${bpN} breakpoint${bpN === 1 ? "" : "s"}`;
  } else {
    tabDebugBadge.hidden = true;
  }
}

function renderBreakpoints(list) {
  if (!list.length) {
    bpListEl.innerHTML = `<li class="empty">No breakpoints. Add a class (binary name) and a line above.</li>`;
    return;
  }
  bpListEl.innerHTML = list
    .map((b) => {
      const status = b.error
        ? `<span class="bp-status error" title="${esc(b.error)}">error</span>`
        : b.verified
          ? `<span class="bp-status ok">armed</span>`
          : `<span class="bp-status pending">pending</span>`;
      return `<li class="bp-row" data-id="${b.id}">
        <span class="bp-where" title="${esc(b.class)}:${b.line}"><span class="bp-class">${esc(shortClass(b.class))}</span><span class="bp-line">:${b.line}</span></span>
        ${status}
        <button class="bp-remove" data-id="${b.id}" title="Remove breakpoint">\u2715</button>
      </li>`;
    })
    .join("");
  bpListEl.querySelectorAll(".bp-remove").forEach((btn) => {
    btn.onclick = () => post("/api/debug/breakpoint/remove", { id: Number(btn.dataset.id) });
  });
}

function renderStack(frames, paused) {
  if (!paused || !frames.length) {
    dbgStackEl.innerHTML = `<li class="empty">${paused ? "No frames." : "The call stack appears while paused."}</li>`;
    return;
  }
  if (dbgSelectedFrame >= frames.length) dbgSelectedFrame = 0;
  dbgStackEl.innerHTML = frames
    .map((f) => {
      const where = f.native ? "(native)" : `${esc(shortClass(f.class))}.${esc(f.method)}:${f.line}`;
      const sel = f.index === dbgSelectedFrame ? " selected" : "";
      return `<li class="stack-frame${sel}" data-index="${f.index}" title="${esc(f.class)}.${esc(f.method)}">
        <span class="frame-idx">${f.index}</span><span class="frame-where">${where}</span>
      </li>`;
    })
    .join("");
  dbgStackEl.querySelectorAll(".stack-frame").forEach((li) => {
    li.onclick = () => {
      const idx = Number(li.dataset.index);
      if (idx === dbgSelectedFrame) return;
      dbgSelectedFrame = idx;
      dbgPausedKey = null; // force a locals refresh for the newly selected frame
      if (debugSnap) renderDebug(debugSnap, statusSnap);
    };
  });
}

// Fetch + render locals for the selected frame (only meaningful while paused).
async function refreshVars() {
  dbgFrameLabel.textContent = ` \u00b7 frame ${dbgSelectedFrame}`;
  dbgVarsEl.innerHTML = `<li class="empty">Loading variables\u2026</li>`;
  let r;
  try {
    r = await (await fetch(`/api/debug/locals?frame=${dbgSelectedFrame}&${qs}`)).json();
  } catch (e) {
    dbgVarsEl.innerHTML = `<li class="empty">Could not read variables: ${esc(e.message)}</li>`;
    return;
  }
  if (!r || r.ok === false) {
    dbgVarsEl.innerHTML = `<li class="empty">${esc((r && r.error) || "No variables.")}</li>`;
    return;
  }
  const vars = r.variables || [];
  if (!vars.length) {
    dbgVarsEl.innerHTML = `<li class="empty">${esc(r.note || "No variables in this frame.")}</li>`;
    return;
  }
  dbgVarsEl.innerHTML = vars
    .map(
      (v) => `<li class="var-row">
      <span class="var-name">${esc(v.name)}</span>
      <span class="var-type">${esc(v.type || "")}</span>
      <span class="var-value" title="${esc(v.value)}">${esc(v.value)}</span>
    </li>`,
    )
    .join("");
  if (r.note) dbgVarsEl.innerHTML += `<li class="empty">${esc(r.note)}</li>`;
}

// Last rendered heap-fill width (%). The metrics panel is rebuilt from scratch
// on every SSE push, so we replay the previous fill width and bump it to the new
// value on the next frame, letting the CSS width transition animate smoothly.
let lastHeapPct = 0;
function renderMetrics(m) {
  const nowUp = !!(m && m.appUp);
  // The metrics tier is the single source of truth for which tool panels are
  // reachable, so refresh the bar's availability on every snapshot.
  const tier = nowUp ? m.metricsTier || "process" : null;
  updateAsideAvailability({
    metrics: nowUp && tier !== "process",
    loggers: nowUp && (tier === "bootui" || tier === "actuator"),
    scans: nowUp && tier === "bootui",
  });
  if (nowUp !== appRunning) {
    appRunning = nowUp;
    // Reflect the app coming up / going down in the Loggers tab if it's open.
    if (loggersTabActive()) loadLoggers();
  }
  if (!m || !m.appUp) {
    lastHeapPct = 0;
    metricsSrc.hidden = true;
    renderMcp(null);
    renderScans(false);
    metricsEl.innerHTML = '<p class="muted">Application isn\u2019t running or doesn\u2019t expose metrics.</p>';
    metricsHint.innerHTML =
      'To get metrics, add <strong>Spring Boot Actuator</strong> or <strong>Quarkus Micrometer/health</strong>. For even richer metrics with Spring Boot, add <a href="https://github.com/jdubois/boot-ui" target="_blank" rel="noopener">BootUI</a>.';
    return;
  }
  metricsSrc.hidden = false;
  metricsSrc.className = "src " + tier;
  metricsSrc.textContent =
    tier === "bootui" ? "BootUI" : tier === "actuator" ? "Actuator" : tier === "quarkus" ? "Quarkus" : "process";

  if (tier === "process") {
    lastHeapPct = 0;
    metricsEl.innerHTML =
      '<p class="muted">App is running, but no <code>/bootui/api</code>, <code>/actuator</code> or <code>/q/metrics</code> endpoint answered, so live JVM metrics aren\u2019t available.</p>';
    metricsHint.innerHTML =
      "Add <code>spring-boot-starter-actuator</code> / BootUI (Spring) or <code>quarkus-micrometer-registry-prometheus</code> (Quarkus) to surface heap, threads and health here.";
    renderMcp(null);
    renderScans(false);
    return;
  }

  const o = m.overview || {};
  const heap = (m.memory && m.memory.heap) || {};
  const nonHeap = (m.memory && m.memory.nonHeap) || {};
  const pct = heap.usedPercent != null ? heap.usedPercent : 0;
  const heapTarget = Math.min(100, pct);
  let html = "";
  if (o.applicationName) html += row("App", esc(o.applicationName));
  if (o.springBootVersion) html += row("Spring Boot", esc(o.springBootVersion));
  if (o.javaVersion) html += row("Java", esc(o.javaVersion));
  if (o.activeProfiles && o.activeProfiles.length) html += row("Profiles", esc(o.activeProfiles.join(", ")));
  if (o.startupTimeMillis != null) html += row("Uptime", (o.startupTimeMillis / 1000).toFixed(2) + " s");
  if (m.health) html += row("Health", esc(m.health.status) || "\u2014");
  if (m.threads) html += row("Threads", `${m.threads.totalThreads} (${m.threads.daemonThreads} daemon)`);
  if (heap.usedBytes != null || heap.maxBytes != null) {
    html += `<h2 style="margin-top:0.75rem">Heap</h2>`;
    html += `<div class="bar"><div style="width:${lastHeapPct}%"></div></div>`;
    html += row("Heap used", `${mb(heap.usedBytes)} / ${mb(heap.maxBytes)} (${pct}%)`);
  }
  if (nonHeap.usedBytes != null) html += row("Non-heap used", mb(nonHeap.usedBytes));
  metricsEl.innerHTML = html || '<p class="muted">No metrics reported.</p>';
  // Animate the heap bar from its previous width to the new value: the fill is
  // emitted at lastHeapPct above, then bumped to the target after a forced
  // reflow so the CSS width transition plays instead of snapping.
  const heapFill = metricsEl.querySelector(".bar > div");
  if (heapFill) {
    void heapFill.offsetWidth;
    heapFill.style.width = heapTarget + "%";
    lastHeapPct = heapTarget;
  }

  if (tier === "bootui") {
    metricsHint.innerHTML =
      "Rich metrics read from the running app\u2019s <code>/bootui/api/**</code> endpoints \u2014 reused directly from BootUI.";
    renderMcp(m.mcp);
    renderScans(true);
  } else if (tier === "quarkus") {
    metricsHint.innerHTML =
      "Metrics read from Quarkus Micrometer (<code>/q/metrics</code>) and SmallRye Health (<code>/q/health</code>).";
    renderMcp(null);
    renderScans(false);
  } else {
    metricsHint.innerHTML =
      "Metrics normalized from Spring Boot <code>/actuator/**</code>. Add BootUI for advisor scans and richer detail.";
    renderMcp(null);
    renderScans(false);
  }
}

// ---- BootUI MCP server panel (agent bridge only) ----------------------
// Coffilot reads advisor scans over REST (see the BootUI tab); this panel just
// manages the in-app MCP server that exposes those scans to the Copilot CLI as
// native tools, so the toggle/register controls are all that remain here.

// Offer "Register with Copilot" only while the MCP server is enabled (and
// therefore reachable). Reset the button's label/enabled state only on the
// hidden→visible transition so a recent "Asked Copilot ✓" survives the
// frequent metrics re-renders.
function showMcpRegister(show) {
  if (!show) {
    mcpRegisterBtn.hidden = true;
    return;
  }
  if (mcpRegisterBtn.hidden) {
    mcpRegisterBtn.hidden = false;
    mcpRegisterBtn.disabled = false;
    mcpRegisterBtn.textContent = "Register with Copilot";
  }
}

// The MCP server lives inside the running app, so the toggle is only
// actionable while a BootUI app (dev profile) exposes its endpoint. The row
// always stays visible in the BootUI panel; when the endpoint is unavailable
// it's greyed out and disabled (rather than hidden) so the control is always
// discoverable.
function setMcpUnavailable() {
  mcpToggle.checked = false;
  mcpToggle.disabled = true;
  mcpToggleLabel.classList.add("disabled");
  mcpState.textContent = "";
  showMcpRegister(false);
}

function renderMcp(mcp) {
  if (!mcp || !mcp.available) {
    setMcpUnavailable();
    return;
  }
  mcpToggle.disabled = false;
  mcpToggleLabel.classList.remove("disabled");
  const enabled = mcp.enabled === true;
  mcpToggle.checked = enabled;
  mcpState.textContent = "";
  showMcpRegister(enabled);
}

async function getJson(path) {
  try {
    const r = await fetch(`${path}?${qs}`);
    return await r.json();
  } catch (e) {
    return { error: e.message };
  }
}

// ---- BootUI advisor scans (BootUI aside tab) --------------------------
// Read straight from BootUI's REST API: /api/scans lists the advisor scans the
// running app exposes (sourced from /bootui/api/panels), and /api/scan runs one
// (POST /bootui/api/{id}/scan). No MCP server round-trip and no enable step — the
// scans show up whenever a BootUI app is up on the metrics "bootui" tier.
let scansLoaded = false;
let currentScans = [];

// A running BootUI app discovers its advisor scans at runtime, but we still show
// the known set as disabled buttons while no BootUI app is up, so the panel keeps
// presenting its scan controls (greyed) instead of an empty gap.
const SCAN_PLACEHOLDERS = [
  "Architecture",
  "Spring",
  "Hibernate",
  "Memory",
  "Security",
  "Pentesting",
  "REST API",
  "GraalVM",
  "CRaC",
];
function renderScanPlaceholders() {
  scansListEl.innerHTML =
    `<button class="tiny scan-all" disabled title="Available once a BootUI app is running.">Scan all</button>` +
    SCAN_PLACEHOLDERS.map(
      (label) => `<button class="tiny" disabled title="Available once a BootUI app is running.">${esc(label)}</button>`,
    ).join("");
}

function renderScans(available) {
  if (!available) {
    scansLoaded = false;
    scansSrc.hidden = true;
    scansHint.innerHTML =
      'Start a <a href="https://github.com/jdubois/boot-ui" target="_blank" rel="noopener">BootUI</a> app (dev profile) with <strong>Run</strong> to run its advisor scans against the live app.';
    renderScanPlaceholders();
    scansResultEl.innerHTML = "";
    markScanResults(false);
    return;
  }
  scansSrc.hidden = false;
  if (!scansLoaded) loadScans();
}

async function loadScans() {
  const st = await getJson("/api/scans");
  const scans = (st && st.scans) || [];
  scansLoaded = true;
  currentScans = scans;
  if (!scans.length) {
    scansHint.textContent = "No advisor scans are available on the running app.";
    scansListEl.innerHTML = "";
    return;
  }
  scansHint.textContent = "Run a BootUI advisor scan against the running app, then push its findings to Copilot.";
  scansListEl.innerHTML =
    `<button class="tiny scan-all" id="scan-all" title="Run every advisor scan in turn.">Scan all</button>` +
    scans
      .map(
        (s) =>
          `<button class="tiny" data-scan="${esc(s.id)}" title="${esc(s.description || s.label)}">${esc(s.label)}</button>`,
      )
      .join("");
  scansListEl.querySelectorAll("button[data-scan]").forEach((b) => (b.onclick = () => runScan(b.dataset.scan)));
  const all = document.getElementById("scan-all");
  if (all) all.onclick = runAllScans;
}

async function runScan(scanKey) {
  scansResultEl.innerHTML = `<span class="muted">Running ${esc(scanKey)}\u2026</span>`;
  markScanResults(true);
  const r = await postJson("/api/scan", { tool: scanKey });
  if (!r || r.ok === false) {
    scansResultEl.innerHTML = `<span style="color:var(--true-color-red,#cf222e)">Scan failed: ${esc((r && r.error) || "unknown error")}</span>`;
    return;
  }
  const entry = { tool: r.tool || scanKey, result: r.result };
  lastScan = entry;
  scansResultEl.innerHTML = scanReportHtml(r, scanKey, "scan-send");
  wireScanSend("scan-send", entry);
}

// Run every available advisor scan in turn, appending each report so the user
// gets one combined run from the prominent "Scan all" button. Each report keeps
// its own "Fix findings with Copilot" CTA.
async function runAllScans() {
  if (!currentScans.length) return;
  const all = document.getElementById("scan-all");
  const orig = all ? all.textContent : "Scan all";
  setScanRowDisabled(true);
  scansResultEl.innerHTML = "";
  markScanResults(true);
  for (let i = 0; i < currentScans.length; i++) {
    const s = currentScans[i];
    if (all) all.textContent = `Scanning\u2026 ${i + 1}/${currentScans.length}`;
    scansResultEl.insertAdjacentHTML(
      "beforeend",
      `<div class="muted" id="scan-progress">Running ${esc(s.label)}\u2026</div>`,
    );
    const r = await postJson("/api/scan", { tool: s.id });
    const prog = document.getElementById("scan-progress");
    if (prog) prog.remove();
    if (!r || r.ok === false) {
      scansResultEl.insertAdjacentHTML(
        "beforeend",
        `<div class="scan-result-item"><strong>${esc(s.label)}</strong> <span style="color:var(--true-color-red,#cf222e)">scan failed: ${esc((r && r.error) || "unknown error")}</span></div>`,
      );
      continue;
    }
    const entry = { tool: r.tool || s.id, result: r.result };
    lastScan = entry;
    const sendId = `scan-send-${i}`;
    scansResultEl.insertAdjacentHTML("beforeend", scanReportHtml(r, s.id, sendId));
    wireScanSend(sendId, entry);
  }
  if (all) all.textContent = orig;
  setScanRowDisabled(false);
}

function setScanRowDisabled(on) {
  scansListEl.querySelectorAll("button").forEach((b) => (b.disabled = on));
}

// Render a scan report as a compact list: one collapsible line per finding
// (severity badge + title), expanding to its details. Defensive about the report
// shape — advisors return different DTOs — and falls back to a single collapsible
// raw-JSON row when no findings array is recognised.
const SCAN_FINDING_KEYS = ["results", "findings", "violations", "issues", "problems", "items", "messages", "entries"];
const SCAN_TITLE_KEYS = ["title", "name", "message", "summary", "rule", "description", "id"];
const SCAN_SKIP_KEYS = new Set(["severity", "level", "priority", "dismissed"]);

function scanReportHtml(r, scanKey, sendId) {
  const result = r.result;
  const findings = extractFindings(result);
  const head =
    `<div class="scan-result-head">` +
    `<strong>${esc(r.label || scanKey)}</strong>` +
    scanCountsHtml(result, findings) +
    `<button class="fix fix-copilot tiny" id="${sendId}">Fix findings with Copilot</button>` +
    `</div>`;
  let body;
  if (Array.isArray(findings)) {
    if (!findings.length) {
      body = `<p class="scan-empty muted">${esc(scanStatusMessage(result) || "No findings \u2014 looks clean.")}</p>`;
    } else {
      body = `<div class="scan-findings">${findings.map(findingRowHtml).join("")}</div>`;
    }
  } else {
    const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
    body =
      `<details class="scan-finding"><summary><span class="finding-title">View report</span></summary>` +
      `<div class="finding-body"><pre class="finding-json">${esc(text)}</pre></div></details>`;
  }
  return `<div class="scan-result-item">${head}${body}</div>`;
}

function extractFindings(result) {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object") {
    for (const k of SCAN_FINDING_KEYS) if (Array.isArray(result[k])) return result[k];
  }
  return null;
}

function scanStatusMessage(result) {
  if (!result || typeof result !== "object") return "";
  return (result.scan && result.scan.message) || result.message || result.status || "";
}

function scanCountsHtml(result, findings) {
  if (result && Array.isArray(result.severityCounts)) {
    const badges = result.severityCounts
      .filter((c) => c && Number(c.count) > 0)
      .map(
        (c) => `<span class="sev-badge ${sevClass(c.severity)}">${esc(String(c.severity))} ${Number(c.count)}</span>`,
      )
      .join("");
    if (badges) return `<span class="scan-counts">${badges}</span>`;
  }
  if (Array.isArray(findings) && findings.length)
    return `<span class="scan-counts muted">${findings.length} finding${findings.length === 1 ? "" : "s"}</span>`;
  return "";
}

function findingRowHtml(item) {
  const { sev, title, titleKey } = findingSummary(item);
  const badge = sev ? `<span class="sev-badge ${sevClass(sev)}">${esc(sev)}</span>` : "";
  const detail = findingDetailHtml(item, titleKey);
  if (!detail) return `<div class="scan-finding flat">${badge}<span class="finding-title">${esc(title)}</span></div>`;
  return (
    `<details class="scan-finding"><summary>${badge}<span class="finding-title">${esc(title)}</span></summary>` +
    `<div class="finding-body">${detail}</div></details>`
  );
}

function findingSummary(item) {
  if (item == null) return { sev: "", title: "\u2014", titleKey: null };
  if (typeof item !== "object") return { sev: "", title: String(item), titleKey: null };
  const sev = item.severity || item.level || item.priority || "";
  let title = "Finding";
  let titleKey = null;
  for (const k of SCAN_TITLE_KEYS) {
    const v = item[k];
    if (v != null && String(v).trim() !== "") {
      title = String(v);
      titleKey = k;
      break;
    }
  }
  return { sev: String(sev), title, titleKey };
}

function findingDetailHtml(item, titleKey) {
  if (item == null || typeof item !== "object") return "";
  const rows = [];
  for (const [k, v] of Object.entries(item)) {
    if (k === titleKey || SCAN_SKIP_KEYS.has(k)) continue;
    if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    rows.push(
      `<div class="finding-kv"><span class="fk">${esc(prettyKey(k))}</span><span class="fv">${renderScanVal(v)}</span></div>`,
    );
  }
  return rows.join("");
}

function prettyKey(k) {
  return String(k)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

function renderScanVal(v) {
  if (Array.isArray(v))
    return `<ul class="finding-list">${v
      .map((x) => `<li>${x && typeof x === "object" ? `<code>${esc(JSON.stringify(x))}</code>` : esc(String(x))}</li>`)
      .join("")}</ul>`;
  if (v && typeof v === "object") return `<pre class="finding-json">${esc(JSON.stringify(v, null, 2))}</pre>`;
  const s = String(v);
  if (/^https?:\/\/\S+$/.test(s)) return `<a href="${esc(s)}" target="_blank" rel="noopener">${esc(s)}</a>`;
  return esc(s);
}

function sevClass(sev) {
  const s = String(sev || "").toLowerCase();
  if (s.startsWith("crit")) return "sev-critical";
  if (s.startsWith("high") || s === "error" || s === "blocker") return "sev-high";
  if (s.startsWith("med") || s.startsWith("warn")) return "sev-medium";
  if (s.startsWith("low") || s === "minor") return "sev-low";
  return "sev-info";
}

function wireScanSend(sendId, entry) {
  const send = document.getElementById(sendId);
  if (send)
    send.onclick = async () => {
      send.disabled = true;
      send.textContent = "Sent to Copilot \u2713";
      await post("/api/fix", { kind: "mcp", tool: entry.tool, result: entry.result });
    };
}
let lastScan = null;

// ---- Quarkus Agent MCP panel ------------------------------------------
// Unlike the BootUI panel (which mirrors an MCP server living inside the running
// app), the Quarkus Agent MCP server is an external process the Copilot CLI
// launches. So this panel is driven purely by static capability — it shows for
// Quarkus projects and offers to register the server + one-click capability
// prompts, regardless of whether the app is currently running.
const QUARKUS_MCP_CAPS = [
  {
    kind: "quarkus-skills",
    label: "Extension skills",
    title:
      "Ask Copilot to load this project's Quarkus extension skills (patterns, testing, pitfalls) via quarkus_skills.",
  },
  {
    kind: "quarkus-docs",
    label: "Search docs",
    title: "Ask Copilot to search the Quarkus documentation via quarkus_searchDocs (needs Docker/Podman).",
  },
  {
    kind: "quarkus-exception",
    label: "Last exception",
    title:
      "Ask Copilot to fetch the running dev-mode app's last exception via devui-exceptions_getLastException and fix it.",
  },
];

function sendQuarkusMcpFix(kind) {
  return post("/api/fix", { kind });
}

function renderQuarkusMcp() {
  const q = caps.quarkusAgentMcp || {};
  if (!caps.quarkus) {
    quarkusMcpPanel.hidden = true;
    return;
  }
  quarkusMcpPanel.hidden = false;
  if (q.available) {
    if (quarkusMcpRegisterBtn.hidden) {
      quarkusMcpRegisterBtn.disabled = false;
      quarkusMcpRegisterBtn.textContent = "Register with Copilot";
    }
    quarkusMcpRegisterBtn.hidden = false;
    quarkusMcpRegisterBtn.dataset.runner = q.runner || "jbang";
    quarkusMcpState.textContent = q.runner === "java" ? "via java" : "via JBang";
    quarkusMcpState.title =
      q.runner === "java"
        ? "JBang wasn't detected; the java -jar launcher will be used."
        : "JBang is available to launch the Quarkus Agent MCP server.";
  } else {
    quarkusMcpRegisterBtn.hidden = true;
    quarkusMcpState.textContent = "JBang/Java not found";
    quarkusMcpState.title =
      "Install JBang (jbang.dev) or Java 21+ so the Quarkus Agent MCP server can be launched, then re-open this canvas.";
  }
  // Build the capability buttons via the DOM (textContent / setAttribute) so the
  // labels and titles are never interpolated into an HTML string.
  quarkusMcpScansEl.replaceChildren(
    ...QUARKUS_MCP_CAPS.map((c) => {
      const btn = document.createElement("button");
      btn.className = "tiny";
      btn.textContent = c.label;
      btn.title = c.title;
      btn.onclick = () => sendQuarkusMcpFix(c.kind);
      return btn;
    }),
  );
}

quarkusMcpRegisterBtn.onclick = async () => {
  quarkusMcpRegisterBtn.disabled = true;
  quarkusMcpRegisterBtn.textContent = "Asked Copilot \u2713";
  await post("/api/fix", { kind: "register-quarkus-mcp", runner: quarkusMcpRegisterBtn.dataset.runner || "jbang" });
};

// ---- Runtime log levels (Loggers aside tab) ----------------------------
// Lists the running app's loggers from Spring Boot Actuator /loggers and lets
// you change a level live (no restart). Self-describes by capability: degrades to
// a hint when the app is down or exposes no /loggers endpoint.
const loggersListEl = document.getElementById("loggers-list");
const loggersControls = document.getElementById("loggers-controls");
const loggersSearch = document.getElementById("loggers-search");
const loggersSrc = document.getElementById("loggers-src");
const LOGGER_LEVELS = ["OFF", "ERROR", "WARN", "INFO", "DEBUG", "TRACE"];
let appRunning = false;
let loggersData = null;
let loggersTimer = null;

function loggersTabActive() {
  const pane = document.getElementById("atab-loggers");
  // offsetParent is null when the pane (or its collapsed drawer) is display:none,
  // so this also stops polling when the narrow-canvas rail is collapsed.
  return !!(pane && pane.classList.contains("active") && pane.offsetParent !== null);
}

function startLoggersPolling() {
  loadLoggers();
  if (loggersTimer) return;
  // Light refresh so externally-changed levels (or the app starting/stopping)
  // are reflected while the tab is open.
  loggersTimer = setInterval(loadLoggers, 5000);
}

function stopLoggersPolling() {
  if (loggersTimer) {
    clearInterval(loggersTimer);
    loggersTimer = null;
  }
}

async function loadLoggers() {
  if (!appRunning) {
    renderLoggers({ available: false, appDown: true });
    return;
  }
  renderLoggers(await getJson("/api/loggers"));
}

function renderLoggers(data, force) {
  if (!data || data.appDown || (!data.available && !appRunning)) {
    loggersSrc.hidden = true;
    loggersControls.hidden = true;
    loggersListEl.innerHTML =
      '<p class="muted">App not running. Click <strong>Run</strong> to control its log levels.</p>';
    loggersData = null;
    return;
  }
  if (!data.available) {
    loggersSrc.hidden = true;
    loggersControls.hidden = true;
    loggersListEl.innerHTML =
      '<p class="muted">No Spring Boot Actuator <code>/loggers</code> endpoint is exposed on the running app, so log ' +
      "levels can\u2019t be changed here. Add <code>spring-boot-starter-actuator</code> and expose it " +
      "(<code>management.endpoints.web.exposure.include=loggers</code>).</p>";
    loggersData = null;
    return;
  }
  loggersData = data;
  loggersSrc.hidden = false;
  loggersSrc.className = "src actuator";
  loggersSrc.textContent = "Actuator";
  loggersControls.hidden = false;
  // Don't rebuild the list out from under the user while they're using it
  // (an open select or focused search box) unless explicitly forced.
  if (!force && loggersListEl.contains(document.activeElement)) return;
  renderLoggersList();
}

function renderLoggersList() {
  if (!loggersData || !loggersData.available) return;
  const levels = loggersData.levels && loggersData.levels.length ? loggersData.levels : LOGGER_LEVELS;
  const term = (loggersSearch.value || "").trim().toLowerCase();
  // No search: show ROOT plus loggers with an explicit level (the interesting
  // ones). With a search: reveal any matching package/class so its level can be set.
  let list = term
    ? loggersData.loggers.filter((l) => l.name.toLowerCase().includes(term))
    : loggersData.loggers.filter((l) => l.name === "ROOT" || l.configuredLevel);
  const CAP = 200;
  const extra = list.length - CAP;
  if (extra > 0) list = list.slice(0, CAP);
  if (!list.length) {
    loggersListEl.innerHTML = `<p class="muted">${
      term
        ? "No loggers match \u201C" + esc(term) + "\u201D."
        : "No explicitly-configured loggers. Search to set a level on any package."
    }</p>`;
    return;
  }
  const note = extra > 0 ? `<p class="hint">${extra} more match \u2014 refine your search.</p>` : "";
  loggersListEl.innerHTML = list.map((l) => loggerRow(l, levels)).join("") + note;
  loggersListEl.querySelectorAll("select[data-logger]").forEach((sel) => {
    sel.addEventListener("change", () => changeLoggerLevel(sel.dataset.logger, sel.value));
  });
}

function loggerRow(l, levels) {
  const cur = l.configuredLevel || "";
  const inheritLabel = l.configuredLevel ? "Inherit" : `Inherit (${esc(l.effectiveLevel || "?")})`;
  const opts =
    `<option value="">${inheritLabel}</option>` +
    levels.map((lv) => `<option value="${lv}"${lv === cur ? " selected" : ""}>${lv}</option>`).join("");
  const eff = (l.configuredLevel || l.effectiveLevel || "").toLowerCase();
  const name = l.name === "ROOT" ? "ROOT" : esc(l.name);
  return (
    `<div class="logger-row"><span class="logger-name" title="${esc(l.name)}">${name}</span>` +
    `<select class="logger-level lvl-${eff}" data-logger="${esc(l.name)}">${opts}</select></div>`
  );
}

async function changeLoggerLevel(name, level) {
  const r = await postJson("/api/loggers", { name, level: level || null });
  if (!r || r.ok === false) {
    appendLine(
      `[canvas] couldn't set ${name} \u2192 ${level || "inherit"}: ${(r && r.error) || "request failed"}`,
      "stderr",
      "run",
    );
  }
  if (r && r.status) {
    loggersData = r.status;
    renderLoggersList();
  } else {
    loadLoggers();
  }
}

if (loggersSearch) loggersSearch.addEventListener("input", () => renderLoggersList());

function statusDot(st) {
  return `<span class="dot ${st}"></span>`;
}

function renderTestProgress(p) {
  if (!p) return;
  const sum = p.summary || { tests: 0, passed: 0, failures: 0, errors: 0, skipped: 0, timeSec: 0 };
  const failed = sum.failures + sum.errors;
  // Live tab badge reflects the running tally.
  tabBadge.hidden = false;
  tabBadge.textContent = failed > 0 ? failed : sum.tests;
  tabBadge.className = "badge " + (failed > 0 ? "bad" : "good");

  let html = "";
  // Progress bar: determinate when we know the previous run's total,
  // otherwise an indeterminate sweep while the run is in flight.
  if (p.running) {
    const done = sum.tests;
    const est = p.estimateTotal || 0;
    if (est > 0) {
      const pct = Math.min(100, Math.round((done / est) * 100));
      const col = failed > 0 ? "var(--true-color-red, #cf222e)" : "var(--true-color-blue, #0969da)";
      html += `<div class="tprogress"><div class="tprogress-fill" style="width:${pct}%;background:${col}"></div></div>`;
    } else {
      html += '<div class="tprogress indeterminate"><div class="tprogress-fill"></div></div>';
    }
  }
  html += '<div class="chips">';
  if (p.running) html += '<span class="chip running"><span class="spinner"></span>running\u2026</span>';
  html += `<span class="chip total"><span class="n">${sum.tests}</span> tests</span>`;
  html += `<span class="chip passed"><span class="n">${sum.passed}</span> passed</span>`;
  if (failed > 0) html += `<span class="chip failed"><span class="n">${failed}</span> failed</span>`;
  if (sum.skipped > 0) html += `<span class="chip skipped"><span class="n">${sum.skipped}</span> skipped</span>`;
  html += "</div>";

  const suites = p.suites || [];
  if (!suites.length) {
    html += '<p class="empty"><span class="spinner"></span> Discovering tests\u2026</p>';
    testsEl.innerHTML = html;
    return;
  }
  for (const s of suites) {
    const running = s.status === "running";
    const dot = running
      ? '<span class="spinner"></span>'
      : statusDot(s.status === "fail" ? "failed" : s.status === "skipped" ? "skipped" : "passed");
    html += `<div class="suite-row${running ? " is-running" : ""}">${dot}`;
    html += `<span class="sname">${esc(s.name)}</span>`;
    if (running) {
      html += '<span class="scount">running\u2026</span>';
    } else {
      const bad = s.failures + s.errors;
      const label = bad > 0 ? `${bad} failed / ${s.tests}` : `${s.tests} tests`;
      html += `<span class="scount">${label} \u00b7 ${(s.timeSec || 0).toFixed(2)}s</span>`;
    }
    html += "</div>";
  }
  testsEl.innerHTML = html;
}

// Last rendered graphical test report + opts, kept so the only-failures /
// search filters can re-render without a new test run.
let lastTestReportData = null;
let lastTestRenderOpts = {};

// Read the current test-view filter from the controls.
function currentTestFilter() {
  return {
    failuresOnly: !!(failuresOnlyInput && failuresOnlyInput.checked),
    query: testSearchEl ? testSearchEl.value.trim().toLowerCase() : "",
  };
}

// Pure: return a shallow-filtered copy of a test report keeping only the suites
// and cases that match the only-failures + search-query filter. A suite whose
// own name matches the query keeps all its cases; otherwise only matching cases
// are kept and empty suites are dropped. The summary is left untouched so the
// chips keep showing run totals.
function filterTestReport(report, filter) {
  if (!report || !report.suites) return report;
  const f = filter || {};
  const q = (f.query || "").toLowerCase();
  if (!f.failuresOnly && !q) return report;
  const suites = [];
  for (const suite of report.suites) {
    const isFail = (c) => c.status === "failed" || c.status === "error";
    const suiteMatches = q && suite.name && suite.name.toLowerCase().includes(q);
    let cases = suite.cases || [];
    if (f.failuresOnly) cases = cases.filter(isFail);
    if (q && !suiteMatches) cases = cases.filter((c) => c.name && c.name.toLowerCase().includes(q));
    if (cases.length) suites.push({ ...suite, cases });
  }
  return { ...report, suites };
}

function renderTests(report, opts) {
  opts = opts || {};
  if (report === null && opts.running) {
    testsEl.innerHTML = '<p class="empty">Running tests\u2026</p>';
    tabBadge.hidden = true;
    if (testFilterEl) testFilterEl.hidden = true;
    lastTestReportData = null;
    return;
  }
  if (!report) {
    testsEl.innerHTML = '<p class="empty">No test run yet. Click <strong>Test</strong> to run the suite.</p>';
    tabBadge.hidden = true;
    if (testFilterEl) testFilterEl.hidden = true;
    lastTestReportData = null;
    return;
  }
  lastTestReportData = report;
  lastTestRenderOpts = opts;
  const s = report.summary;
  // A non-zero exit with no executed tests means the build failed before any test
  // ran — almost always a compile error. Show that plainly instead of a misleading
  // "0 tests / no reports" view, and point at the console + Fix button. (A Stop
  // leaves buildExit null, so an interrupted run never shows as a build failure.)
  if (report.buildExit != null && report.buildExit !== 0 && s.tests === 0) {
    const toolName = (caps && caps.toolLabel) || "build";
    testsEl.innerHTML =
      '<p class="empty bad">Build failed (exit ' +
      report.buildExit +
      ") before any tests ran \u2014 check the " +
      esc(toolName) +
      " console above for the compilation error" +
      ", or click <strong>Fix with Copilot</strong>.</p>";
    tabBadge.hidden = false;
    tabBadge.textContent = "!";
    tabBadge.className = "badge bad";
    if (testFilterEl) testFilterEl.hidden = true;
    return;
  }
  const failed = s.failures + s.errors;
  // Tab badge
  tabBadge.hidden = false;
  tabBadge.textContent = failed > 0 ? failed : s.tests;
  tabBadge.className = "badge " + (failed > 0 ? "bad" : "good");

  let html = '<div class="chips">';
  html += `<span class="chip total"><span class="n">${s.tests}</span> tests</span>`;
  html += `<span class="chip passed"><span class="n">${s.passed}</span> passed</span>`;
  if (failed > 0) html += `<span class="chip failed"><span class="n">${failed}</span> failed</span>`;
  if (s.skipped > 0) html += `<span class="chip skipped"><span class="n">${s.skipped}</span> skipped</span>`;
  html += `<span class="chip time">${s.timeSec.toFixed(2)}s</span>`;
  if (opts.runnerLabel) html += `<span class="chip runner">${esc(opts.runnerLabel)}</span>`;
  html += "</div>";

  if (!report.suites.length) {
    html += '<p class="empty">No test reports found for this run.</p>';
    testsEl.innerHTML = html;
    if (testFilterEl) testFilterEl.hidden = true;
    return;
  }

  // Show the filter controls now that we have suites to filter, then render the
  // filtered view (only-failures + search).
  if (testFilterEl) testFilterEl.hidden = false;
  const view = filterTestReport(report, currentTestFilter());
  if (!view.suites.length) {
    html += '<p class="empty">No tests match the current filter.</p>';
    testsEl.innerHTML = html;
    return;
  }

  for (const suite of view.suites) {
    const bad = suite.failures + suite.errors;
    const open = bad > 0 ? " open" : "";
    html += `<details class="suite"${open}>`;
    html += `<summary>${statusDot(bad > 0 ? "failed" : "passed")}<span class="sname">${esc(suite.name)}</span>`;
    html += `<span class="scount">${suite.cases.length} tests \u00b7 ${suite.timeSec.toFixed(2)}s</span></summary>`;
    for (const c of suite.cases) {
      const isFail = c.status === "failed" || c.status === "error";
      if (isFail) {
        html += `<details class="case-fail"><summary>${statusDot(c.status)}`;
        html += `<span class="msg">${esc(c.name)}${c.message ? " \u2014 " + esc(c.message) : ""}</span>`;
        html += `<span class="ctime">${c.timeSec.toFixed(3)}s</span></summary>`;
        if (c.detail) html += `<pre>${esc(c.detail)}</pre>`;
        html += `</details>`;
      } else {
        html += `<div class="case">${statusDot(c.status)}<span class="cname">${esc(c.name)}</span>`;
        html += `<span class="ctime">${c.timeSec.toFixed(3)}s</span></div>`;
      }
    }
    html += `</details>`;
  }
  testsEl.innerHTML = html;
}

// Affected-test selection banner. `sel` is the server's
// computeAffectedTests() result (or an error/skip variant).
function renderTestSelection(sel) {
  if (!testSelectionEl) return;
  if (!sel || !sel.ok) {
    testSelectionEl.hidden = false;
    testSelectionEl.className = "test-selection warn";
    testSelectionEl.textContent = (sel && sel.message) || "Affected-test selection is unavailable.";
    return;
  }
  if (!sel.sources || !sel.sources.length) {
    testSelectionEl.hidden = false;
    testSelectionEl.className = "test-selection warn";
    testSelectionEl.textContent =
      sel.changedFiles && sel.changedFiles.length
        ? "No changed Java/Kotlin sources vs HEAD — nothing to test."
        : "No uncommitted changes vs HEAD — nothing to test.";
    return;
  }
  const n = (sel.tests || []).length;
  const files = sel.sources.length;
  let txt = `Affected: ${n} test class${n === 1 ? "" : "es"} affected by ${files} changed source${files === 1 ? "" : "s"} vs HEAD`;
  if (sel.fallback) txt += " · name-based (run Build for dependency-accurate selection)";
  testSelectionEl.hidden = false;
  testSelectionEl.className = "test-selection" + (n ? "" : " warn");
  testSelectionEl.textContent = txt;
}

function hideTestSelection() {
  if (testSelectionEl) testSelectionEl.hidden = true;
}

// Sync the two Test-view toggles with server + settings state. Continuous
// testing always uses affected selection, so while it's on the Full build
// toggle is forced off and greyed out; turning it off restores the user's
// persisted choice. Both are disabled when no build tool is present.
function reflectTestToggles() {
  if (!fullbuildToggle || !continuousToggle) return;
  const cont = !!(statusSnap && statusSnap.continuous && statusSnap.continuous.enabled);
  continuousInput.checked = cont;
  continuousInput.disabled = !toolPresent;
  continuousToggle.classList.toggle("disabled", !toolPresent);
  const fbDisabled = !toolPresent || cont;
  fullbuildInput.checked = cont ? false : fullBuildSetting;
  fullbuildInput.disabled = fbDisabled;
  fullbuildToggle.classList.toggle("disabled", fbDisabled);
}

function populateModules(modules) {
  // A non-array means the env probe is unavailable (e.g. a failed fetch);
  // leave whatever is currently shown rather than wiping it.
  if (!Array.isArray(modules)) return;
  // An empty array means the probe ran but found no Maven project: surface
  // that instead of leaving the dropdown stuck on "Scanning modules…".
  if (!modules.length) {
    moduleSelect.innerHTML = '<option value="" disabled selected>No Maven modules found</option>';
    return;
  }
  const prev = moduleSelect.value;
  const runnable = modules.filter((m) => m.runnable);
  const libs = modules.filter((m) => !m.runnable);
  const optgroup = (label, items) => {
    if (!items.length) return "";
    const opts = items.map((m) => `<option value="${esc(m.name)}">${esc(m.artifactId || m.name)}</option>`).join("");
    return `<optgroup label="${esc(label)}">${opts}</optgroup>`;
  };
  moduleSelect.innerHTML = optgroup("Runnable apps", runnable) + optgroup("Libraries", libs);
  // Restore a prior choice, else default to the first runnable app.
  const names = modules.map((m) => m.name);
  if (names.includes(prev)) moduleSelect.value = prev;
  else if (runnable.length) moduleSelect.value = runnable[0].name;
}

// Modules backing the picker; used to decide which dev-setup proposals to offer.
let moduleList = [];

// Per selected module (one reactor can mix capabilities), decide which
// settings rows/proposals to surface:
// - Spring Boot or Quarkus -> show the run-profile + random-port rows.
// - Spring Boot -> also show DevTools (Quarkus dev mode has live reload built
//   in, so no DevTools row) and the BootUI / DevTools "add" proposals.
// - Spring Boot but no BootUI starter -> offer to add BootUI.
// - Spring Boot but no DevTools -> offer to add DevTools and disable the
//   "Enable Spring Boot DevTools" toggle until the dependency is present.
function updateDevSetup() {
  const mod = moduleList.find((m) => m.name === moduleSelect.value);
  const spring = !!(mod && mod.springBoot);
  const quarkus = !!(mod && mod.quarkus);
  const framework = spring || quarkus;
  // Profiles + random-port apply to both frameworks; DevTools is Spring-only.
  setSpring.hidden = !framework;
  setDevtools.hidden = !spring;
  setRandomport.hidden = !framework;
  // The BootUI MCP server toggle stays visible in the BootUI panel; renderMcp /
  // setMcpUnavailable grey and disable it until a running BootUI app exposes the
  // endpoint, so it is never hidden.

  // Relabel the run-profile combo and swap its suggestions for the framework.
  if (lblProfiles) lblProfiles.textContent = quarkus ? "Quarkus profile" : "Spring Boot profiles";
  profileItems = quarkus ? quarkusItems : springItems;

  // Activate-BootUI CTA: only available — shown and enabled — for a Spring Boot
  // module that doesn't depend on BootUI yet. Hidden for non-Spring apps and once
  // the module already has BootUI (since it's then active).
  const hasBootui = !!(mod && mod.bootui);
  const canAddBootui = spring && !hasBootui;
  btnAddBootui.hidden = !canAddBootui;
  btnAddBootui.disabled = !canAddBootui;
  btnAddBootui.textContent = caps.gradle ? "Add BootUI (developmentOnly)" : "Add BootUI to dev profile";
  btnAddBootui.title =
    "Add the BootUI starter to this module's dev profile to unlock its console, richer metrics and advisor scans.";

  const hasDevtools = spring && !!mod.devtools;
  const showDevtools = spring && !mod.devtools;
  btnAddDevtools.hidden = !showDevtools;
  if (showDevtools) {
    btnAddDevtools.disabled = false;
    btnAddDevtools.textContent = caps.gradle ? "Add DevTools (developmentOnly)" : "Add DevTools to dev profile";
  }
  // The DevTools toggle only makes sense once the dependency is on the
  // classpath; grey it out and explain via the info tooltip otherwise.
  devtoolsToggle.classList.toggle("disabled", !hasDevtools);
  devtoolsInput.disabled = !hasDevtools;
  document.getElementById("devtools-info").dataset.tip = hasDevtools
    ? "Watch the running module's sources and recompile on save so DevTools restarts the app in place."
    : caps.gradle
      ? "Add Spring Boot DevTools (button below) to enable live reload."
      : "Add Spring Boot DevTools to the dev profile first (button below) to enable live reload.";
}

// Suggestion lists backing the custom comboboxes (kept editable).
let springItems = ["dev"];
let quarkusItems = ["dev", "test", "prod"];
// The run-profile combo shows whichever list matches the selected module.
let profileItems = springItems;
let mavenItems = [];

// A lightweight combobox: editable input + an in-document suggestion menu,
// with substring filtering, hover/keyboard selection, and outside-click
// dismissal. Avoids the native <datalist> popup, which renders at the wrong
// position (far left, outside the panel) inside the canvas iframe.
function setupCombo(input, menu, getItems) {
  let active = -1;
  const visibleOpts = () => [...menu.querySelectorAll(".opt")];
  function paintActive() {
    const opts = visibleOpts();
    opts.forEach((o, i) => o.classList.toggle("active", i === active));
    if (active >= 0 && opts[active]) opts[active].scrollIntoView({ block: "nearest" });
  }
  function open(useFilter) {
    const all = getItems() || [];
    const q = useFilter ? input.value.trim().toLowerCase() : "";
    const list = q ? all.filter((v) => v.toLowerCase().includes(q)) : all;
    active = -1;
    if (!all.length) {
      menu.hidden = true;
      return;
    }
    menu.innerHTML = list.length
      ? list.map((v) => `<div class="opt" data-val="${esc(v)}">${esc(v)}</div>`).join("")
      : '<div class="empty-opt">No matching profile (free text allowed)</div>';
    menu.querySelectorAll(".opt").forEach((el) => {
      el.onmousedown = (e) => {
        e.preventDefault();
        input.value = el.dataset.val;
        hide();
        input.dispatchEvent(new Event("change"));
      };
    });
    menu.hidden = false;
  }
  function hide() {
    menu.hidden = true;
    active = -1;
  }
  // Focus shows every option (easy switching); typing filters by substring.
  input.addEventListener("focus", () => open(false));
  input.addEventListener("input", () => open(true));
  input.addEventListener("keydown", (e) => {
    if (menu.hidden) {
      if (e.key === "ArrowDown") open(false);
      return;
    }
    const opts = visibleOpts();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      active = Math.min(active + 1, opts.length - 1);
      paintActive();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      active = Math.max(active - 1, 0);
      paintActive();
    } else if (e.key === "Enter") {
      if (active >= 0 && opts[active]) {
        e.preventDefault();
        input.value = opts[active].dataset.val;
        hide();
        input.dispatchEvent(new Event("change"));
        return;
      }
      hide();
    } else if (e.key === "Escape") {
      hide();
    }
  });
  // Delay so a menu click (mousedown sets the value) isn't cancelled by blur.
  input.addEventListener("blur", () => setTimeout(hide, 150));
}

// Reflect persisted settings onto the toggle switches + Spring profiles
// combo. Skip the combo while it's focused so we don't clobber typing.
function applySettingsState(s) {
  if (!s) return;
  warmInput.checked = !warmInput.disabled && s.warm === true;
  devtoolsInput.checked = s.devtools === true;
  randomportInput.checked = s.randomPort === true;
  if (maskSecretsInput) maskSecretsInput.checked = s.maskSecrets !== false;
  if (metricsPollInput && document.activeElement !== metricsPollInput) {
    metricsPollInput.value = Number(s.metricsPollMs) || 2500;
  }
  openBrowserInput.checked = s.openBrowser === true;
  fullBuildSetting = s.fullBuild === true;
  buildCleanInput.checked = s.buildClean === true;
  packageCleanInput.checked = s.packageClean === true;
  packageInstallInput.checked = s.packageInstall === true;
  reflectTestToggles();
  if (autoProfileInput) autoProfileInput.checked = s.autoProfile === true;
  if (flameEvent && typeof s.autoProfileEvent === "string" && document.activeElement !== flameEvent) {
    flameEvent.value = s.autoProfileEvent;
  }
  if (flameDuration && s.autoProfileDuration != null && document.activeElement !== flameDuration) {
    const want = String(s.autoProfileDuration);
    if ([...flameDuration.options].some((o) => o.value === want)) flameDuration.value = want;
  }
  if (document.activeElement !== springInput && typeof s.springProfiles === "string") {
    springInput.value = s.springProfiles;
  }
  if (jdkSelect && document.activeElement !== jdkSelect) {
    const want = typeof s.jdkHome === "string" ? s.jdkHome : "";
    // Only set if the option exists; otherwise fall back to Auto so a stale/removed
    // JDK doesn't leave the control on a phantom value.
    jdkSelect.value = [...jdkSelect.options].some((o) => o.value === want) ? want : "";
  }
  applyAsideState(s);
}

function applyEnv(env) {
  moduleList = (env && env.modules) || [];
  populateModules(env && env.modules);
  applyJdtls(env && env.jdtls);
  applyJdks(env);
  applyCaps(env && env.capabilities);
  // Build the run-profile suggestion lists before updateDevSetup() picks one.
  // "dev" is always offered for Spring (it's the default and activates BootUI);
  // Quarkus always offers its built-in dev / test / prod profiles.
  const spring = (env && env.springProfiles) || [];
  springItems = spring.includes("dev") ? spring : ["dev", ...spring];
  const quarkus = (env && env.quarkusProfiles) || [];
  quarkusItems = quarkus.length ? quarkus : ["dev", "test", "prod"];
  mavenItems = (env && env.mavenProfiles) || [];
  updateDevSetup();

  // Degraded mode: no Maven or Gradle project. Show the banner and disable
  // the build/test/package/run actions; nothing can be invoked without a tool.
  toolPresent = !!(env && env.buildTool);
  if (noToolBanner) noToolBanner.hidden = toolPresent;
  btnRun.disabled = !toolPresent;
  btnDebug.disabled = !toolPresent;
  for (const op of ["build", "test", "package"]) {
    if (mvnButtons[op]) mvnButtons[op].disabled = !toolPresent;
  }
  if (statusSnap) renderStatus(statusSnap);

  // Maven profiles are Maven-only; hide the control for Gradle / no tool.
  const profilesSupported = !!(env && env.profilesSupported);
  const setMvnProfiles = document.getElementById("set-mvn-profiles");
  if (setMvnProfiles) setMvnProfiles.hidden = !profilesSupported;
  if (mvnProfilesLabel) mvnProfilesLabel.hidden = !profilesSupported;
  if (mvnProfilesCombo) mvnProfilesCombo.hidden = !profilesSupported;

  // Warm-JVM tier: mvnd for Maven (install-gated), the Gradle daemon for
  // Gradle (always available). The backend reports the label/tip/availability.
  const ok = !!(env && env.warmAvailable);
  warmInput.disabled = !ok;
  warmToggle.classList.toggle("disabled", !ok);
  warmLabel.textContent = (env && env.warmLabel) || "Keep JVM warm";
  warmInfo.dataset.tip = (env && env.warmTip) || "Keep a warm JVM between builds/tests for faster repeat runs.";
  // The install banner only applies to Maven when mvnd is missing; Gradle's
  // daemon needs no install, so hide it whenever the warm tier is available
  // (or there's no tool at all).
  warmBanner.hidden = ok || !toolPresent;
  if (!ok && toolPresent) {
    const install = (env && env.install) || {};
    const os = install.os ? ` on ${install.os}` : "";
    if (install.cmd) {
      warmMsg.innerHTML =
        `The Maven Daemon (<strong>mvnd</strong>) isn't installed${os}, so ` +
        `<strong>Keep&nbsp;JVM&nbsp;warm</strong> is disabled. Install it to enable faster repeat builds/tests:`;
      warmCmd.textContent = install.cmd;
      warmCmd.hidden = false;
    } else {
      warmMsg.innerHTML =
        `The Maven Daemon (<strong>mvnd</strong>) isn't installed${os}, so ` +
        `<strong>Keep&nbsp;JVM&nbsp;warm</strong> is disabled. Download it and add its <code>bin</code> folder to your PATH:`;
      warmCmd.hidden = true;
    }
    warmDocs.href = install.url || "https://github.com/apache/maven-mvnd";
  }
  applySettingsState(env && env.settings);
  applyProfilerEnv(env && env.profiler);
}

async function post(path, body) {
  try {
    await fetch(`${path}?${qs}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
  } catch (e) {
    appendLine("[canvas] request failed: " + e.message, "stderr");
  }
}

async function postJson(path, body) {
  try {
    const r = await fetch(`${path}?${qs}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    return await r.json();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Show/hide capability-gated controls and render a capability summary.
function applyCaps(c) {
  caps = c || {};
  const toolLabel = caps.toolLabel || (caps.gradle ? "Gradle" : caps.maven ? "Maven" : null);
  const springRun = caps.gradle ? "bootRun" : "spring-boot:run";
  const quarkusRun = caps.gradle ? "quarkusDev" : "quarkus:dev";
  // Pure-Java modules can still Run (the generic runner builds, then launches via
  // the Gradle application plugin / an executable jar / the configured main class);
  // framework-specific settings rows are toggled per selected module in updateDevSetup().
  const genericRun = caps.gradle
    ? "Build the selected module and launch it (Gradle application run, executable jar, or its main class)."
    : "Build the selected module and launch it (executable jar via java -jar, or its main class via java -cp).";
  btnRun.title = caps.springBoot
    ? `Run the selected module with ${springRun}.`
    : caps.quarkus
      ? `Run the selected module with ${quarkusRun}.`
      : genericRun;
  const pill = (label, on, title) =>
    `<span class="cap ${on ? "on" : "off"}" title="${esc(title)}">${esc(label)}</span>`;
  let html = "";
  html += pill(
    "Java" + (caps.java ? " " + caps.java : ""),
    true,
    toolLabel ? `Java + ${toolLabel} build and test are available.` : "Java build/test (no build tool detected).",
  );
  // Active build tool: Maven or Gradle (off/grey when neither is present).
  html += pill(
    toolLabel || "No build tool",
    !!toolLabel,
    toolLabel ? `${toolLabel} build/test.` : "No Maven or Gradle project detected.",
  );
  // Active JDK: the runtime that Build / Test / Package / Run / Debug use, so the
  // user can confirm which JDK a run used (selected via Settings, else system).
  if (activeJdkInfo && activeJdkInfo.version) {
    html += pill(
      `JDK ${activeJdkInfo.version}`,
      true,
      activeJdkInfo.auto
        ? `Active JDK ${activeJdkInfo.version} (system default${activeJdkInfo.home ? ` · ${activeJdkInfo.home}` : ""}). Change it in Settings.`
        : `Active JDK ${activeJdkInfo.version} (selected in Settings${activeJdkInfo.home ? ` · ${activeJdkInfo.home}` : ""}).`,
    );
  }
  html += pill(
    "Spring Boot",
    !!caps.springBoot,
    caps.springBoot ? `${springRun} available.` : "No Spring Boot module detected; Run uses the generic launcher.",
  );
  html += pill(
    "Quarkus",
    !!caps.quarkus,
    caps.quarkus
      ? `${quarkusRun} available (dev mode with live reload).`
      : "No Quarkus module detected; Run uses java -jar.",
  );
  html += pill("Actuator", !!caps.actuator, "Spring Boot Actuator metrics (static hint; confirmed at runtime).");
  html += pill("BootUI", !!caps.bootui, "BootUI rich metrics + MCP advisor scans.");
  if (caps.quarkus) {
    const q = caps.quarkusAgentMcp || {};
    html += pill(
      "Quarkus MCP",
      !!q.available,
      q.available
        ? `Quarkus Agent MCP can be launched (${q.runner === "java" ? "java" : "JBang"}) — register it from Settings.`
        : "Quarkus Agent MCP needs JBang or Java 21+ to launch; not detected.",
    );
  }
  html += pill(
    "JDTLS",
    !!jdtlsState.available,
    jdtlsState.available
      ? "Eclipse JDT Language Server is available — Copilot has Java code intelligence."
      : "JDTLS (Java code intelligence) isn't available; set it up from Settings.",
  );
  capsEl.innerHTML = html;
  renderQuarkusMcp();
}

// Render the JDTLS availability indicator + setup affordance in Settings.
// JDTLS isn't part of this extension (the Copilot CLI launches it), so this
// reflects a real availability check from the backend.
function applyJdtls(j) {
  jdtlsState = j || {};
  // The row is meaningful for any Java project, which Coffilot always is.
  setJdtls.hidden = false;
  const available = !!jdtlsState.available;
  const reason = jdtlsState.reason || null;
  const install = jdtlsState.install || {};
  const java = jdtlsState.java || {};

  jdtlsDot.classList.toggle("on", available);
  jdtlsDot.classList.toggle("off", !available && reason !== "old-jdk");
  jdtlsDot.classList.toggle("warn", !available && reason === "old-jdk");

  if (available) {
    jdtlsStateEl.textContent = jdtlsState.indexed ? "working · indexed this project" : "working";
    jdtlsInfoEl.dataset.tip =
      "JDTLS is installed and wired into the Copilot CLI" +
      (java.version ? ` (JDK ${java.version})` : "") +
      " — Java go-to-definition, find references and hover are available.";
    btnSetupJdtls.hidden = true;
    jdtlsBanner.hidden = true;
    return;
  }

  // Not available: explain why, surface the install command, offer setup.
  const label =
    reason === "no-launcher"
      ? "not installed"
      : reason === "old-jdk"
        ? `needs Java ${jdtlsState.minJava || 21}+`
        : reason === "no-config"
          ? "not configured"
          : "not available";
  jdtlsStateEl.textContent = label;

  const msg =
    reason === "no-launcher"
      ? "The <strong>jdtls</strong> launcher isn't on your PATH, so Copilot can't provide Java code intelligence. Install it:"
      : reason === "old-jdk"
        ? `The active JDK (${esc(java.version || "unknown")}) is older than Java ${jdtlsState.minJava || 21}, which JDTLS requires. Install/select a newer JDK, then:`
        : reason === "no-config"
          ? "The Copilot CLI has no Java language-server entry, so it never launches JDTLS. Set it up:"
          : "JDTLS (Java code intelligence) couldn't be confirmed. Set it up:";
  jdtlsMsg.innerHTML = msg;
  if (install.cmd) {
    jdtlsCmd.textContent = install.cmd;
    jdtlsCmd.hidden = false;
  } else {
    jdtlsCmd.hidden = true;
  }
  jdtlsDocs.href = install.url || "https://github.com/eclipse-jdtls/eclipse.jdt.ls";
  jdtlsInfoEl.dataset.tip =
    "JDTLS gives Copilot Java go-to-definition, find references and hover. It isn't available right now — use “Set up JDTLS” to have Copilot install and wire it.";
  btnSetupJdtls.hidden = false;
  btnSetupJdtls.disabled = false;
  btnSetupJdtls.textContent = "Set up JDTLS";
  jdtlsBanner.hidden = false;
}

// Populate the JDK selector from the discovered JDKs, reflect the active one, and
// (when SDKMAN is present with a single JDK) suggest installing another. The SDKMAN
// recommendation itself lives in the JDK info tooltip. The selected value is
// `settings.jdkHome` ("" = Auto), applied later by applySettingsState.
function applyJdks(env) {
  if (!jdkSelect) return;
  activeJdkInfo = (env && env.activeJdk) || null;
  const jdks = (env && env.jdks) || [];
  const install = (env && env.jdkInstall) || {};

  // Rebuild the option list: Auto first, then each discovered JDK.
  const want = jdkSelect.value;
  jdkSelect.innerHTML = "";
  const auto = document.createElement("option");
  auto.value = "";
  const autoLabel =
    activeJdkInfo && activeJdkInfo.auto && activeJdkInfo.version
      ? `Auto (system default · ${activeJdkInfo.version})`
      : "Auto (system default)";
  auto.textContent = autoLabel;
  jdkSelect.appendChild(auto);
  for (const j of jdks) {
    if (!j || !j.home) continue;
    const opt = document.createElement("option");
    opt.value = j.home;
    const src = j.source === "JAVA_HOME" ? " · JAVA_HOME" : "";
    opt.textContent = `${j.label || j.version || j.home}${src}`;
    opt.title = j.home;
    jdkSelect.appendChild(opt);
  }
  // Restore a pending selection if it survived the rebuild (applySettingsState
  // sets the authoritative value from settings shortly after).
  if (want && [...jdkSelect.options].some((o) => o.value === want)) jdkSelect.value = want;

  if (jdkInfo) {
    // We recommend SDKMAN for installing and switching between JDKs; surfaced in
    // the tooltip rather than as a banner so it's always one hover away.
    const sdkmanTip = " We recommend SDKMAN (sdkman.io) to install and switch between JDKs.";
    if (activeJdkInfo) {
      const home = activeJdkInfo.home ? ` (${activeJdkInfo.home})` : "";
      jdkInfo.dataset.tip =
        `Active JDK: ${activeJdkInfo.version || "unknown"}${home}. ` +
        "Used for Build / Test / Package / Run / Debug. Change applies to the next launch." +
        sdkmanTip;
    } else {
      jdkInfo.dataset.tip = "Choose the JDK used for Build / Test / Package / Run / Debug." + sdkmanTip;
    }
  }

  // Install banner: only when SDKMAN is present but a single JDK is installed
  // (suggest installing another to switch between). Hidden otherwise — the
  // recommendation to install SDKMAN itself lives in the JDK info tooltip.
  if (jdkBanner) {
    const onlyOne = jdks.length <= 1;
    if (install.sdkman && onlyOne) {
      jdkMsg.innerHTML = "Only one JDK was found. Install another with <strong>SDKMAN</strong> to switch between JDKs:";
      jdkCmd.textContent = install.cmd || "sdk install java";
      jdkCmd.hidden = false;
      jdkDocs.href = install.url || "https://sdkman.io/jdks";
      jdkBanner.hidden = false;
    } else {
      jdkBanner.hidden = true;
    }
  }
}

const warm = () => warmInput.checked === true;
const mvnProfiles = () => mvnProfilesInput.value.trim();

setupCombo(springInput, springMenu, () => profileItems);
setupCombo(mvnProfilesInput, mavenMenu, () => mavenItems);

// Each trigger button starts its lane, or — if that lane is already busy —
// restarts it (stop the current process, then relaunch with the same inputs).
function triggerLane(op, startPath, body) {
  if (restarting[op]) return; // a restart is already in flight (either phase)
  const busy =
    op === "run" || op === "debug" ? laneBusy(op) : laneBusy("build") || laneBusy("test") || laneBusy("package");
  if (busy) {
    markRestarting(op);
    if (statusSnap) renderStatus(statusSnap); // reflect "Restarting…" without waiting for the next event
    restartLane(op, body);
  } else {
    post(startPath, body);
  }
}

async function restartLane(op, body) {
  const res = await postJson("/api/restart", { op, ...body });
  // On success the relaunch is in flight and syncRestarting clears the mask when
  // it reports busy. On failure (e.g. the stop timed out), drop the mask now
  // instead of leaving the trigger stuck until the 20s backstop.
  if (res && res.ok === false) {
    appendLine("[canvas] restart failed: " + (res.error || "unknown error"), "stderr", op);
    clearRestarting(op);
    if (statusSnap) renderStatus(statusSnap);
  }
}

// Stop a lane. `which` is the lane group: "run" (the app) or "maven" (the shared
// build/test/package lane). `op` is the specific Maven op that's running.
function stopLane(which, op) {
  if (stopping[which]) return;
  if (which === "run") {
    clearRestarting("run");
    markStopping("run", "run");
    post("/api/stop", { op: "run" });
    return;
  }
  if (which === "debug") {
    clearRestarting("debug");
    markStopping("debug", "debug");
    post("/api/debug/stop", {});
    return;
  }
  const s = statusSnap || {};
  const target = op || ["build", "test", "package"].find((o) => s[o] && s[o].busy) || activeTab;
  // A Stop wins over any in-flight restart of the build group.
  ["build", "test", "package"].forEach(clearRestarting);
  markStopping("maven", target);
  post("/api/stop", { op: "maven" });
}

// One button per lane: it starts the lane when idle, or stops it while busy.
function laneAction(op) {
  if (op === "run") {
    if (laneBusy("run")) return stopLane("run");
    showTab("run");
    triggerLane("run", "/api/run", {
      module: document.getElementById("in-module").value.trim(),
      profiles: document.getElementById("in-profiles").value.trim(),
      mavenProfiles: mvnProfiles(),
    });
    return;
  }
  if (op === "debug") {
    if (laneBusy("debug")) return stopLane("debug");
    showTab("debug");
    triggerLane("debug", "/api/debug/start", {
      module: document.getElementById("in-module").value.trim(),
      profiles: document.getElementById("in-profiles").value.trim(),
      mavenProfiles: mvnProfiles(),
      suspend: dbgSuspendInput.checked,
    });
    return;
  }
  // build / test / package share the serialized Maven lane.
  const busyOp = ["build", "test", "package"].find(laneBusy);
  if (busyOp === op) return stopLane("maven", op); // this lane is running → stop it
  if (busyOp) return; // a sibling is running (the button is disabled anyway)
  showTab(op);
  if (op === "test") {
    // Continuous testing always uses affected selection; otherwise the Full build
    // toggle decides between the affected subset (off) and the whole suite (on).
    const continuousOn = !!(statusSnap && statusSnap.continuous && statusSnap.continuous.enabled);
    const affected = continuousOn || !fullbuildInput.checked;
    if (!affected) hideTestSelection();
    triggerLane("test", "/api/test", { affected, warm: warm(), mavenProfiles: mvnProfiles() });
    return;
  }
  const body = { warm: warm(), mavenProfiles: mvnProfiles() };
  if (op === "build") body.clean = buildCleanInput.checked === true;
  if (op === "package") {
    body.clean = packageCleanInput.checked === true;
    body.install = packageInstallInput.checked === true;
  }
  triggerLane(op, "/api/" + op, body);
}

document.getElementById("btn-build").onclick = () => laneAction("build");
document.getElementById("btn-test").onclick = () => laneAction("test");
document.getElementById("btn-package").onclick = () => laneAction("package");
document.getElementById("btn-run").onclick = () => laneAction("run");

// --- Debug lane controls ---------------------------------------------------
// The Debug trigger launches the app with JDWP and attaches the debugger; it is
// mutually exclusive with Run (the backend rejects if the app is already up). The
// single lane button starts the session when idle and stops it while busy.
btnDebug.onclick = () => laneAction("debug");
btnDbgContinue.onclick = () => post("/api/debug/continue", {});
btnDbgStepOver.onclick = () => post("/api/debug/step", { depth: "over" });
btnDbgStepInto.onclick = () => post("/api/debug/step", { depth: "into" });
btnDbgStepOut.onclick = () => post("/api/debug/step", { depth: "out" });
btnDbgPause.onclick = () => post("/api/debug/pause", {});

function addBreakpoint() {
  const klass = bpClassInput.value.trim();
  const line = parseInt(bpLineInput.value, 10);
  if (!klass || !Number.isInteger(line) || line <= 0) {
    appendLine("[canvas] enter a class (binary name) and a positive line number", "stderr", "debug");
    return;
  }
  post("/api/debug/breakpoint", { class: klass, line });
  bpLineInput.value = "";
}
btnBpAdd.onclick = addBreakpoint;
bpClassInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addBreakpoint();
});
bpLineInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addBreakpoint();
});

async function evalExpr() {
  const expr = dbgEvalInput.value.trim();
  if (!expr) return;
  dbgEvalResult.textContent = "\u2026";
  dbgEvalResult.className = "eval-result";
  const r = await postJson("/api/debug/evaluate", { expression: expr, frame: dbgSelectedFrame });
  if (!r || r.ok === false) {
    dbgEvalResult.textContent = (r && r.error) || "Evaluation failed.";
    dbgEvalResult.className = "eval-result error";
  } else {
    dbgEvalResult.textContent = `${r.value}${r.type ? `  (${r.type})` : ""}`;
    dbgEvalResult.className = "eval-result ok";
  }
}
btnDbgEval.onclick = evalExpr;
dbgEvalInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") evalExpr();
});

// Run tab: force-open the running app in a browser.
btnOpenBrowser.onclick = () => post("/api/open-app", {});

// Re-evaluate dev-setup proposals/toggles when the user switches modules.
moduleSelect.addEventListener("change", () => {
  updateDevSetup();
});
btnAddBootui.onclick = async () => {
  btnAddBootui.disabled = true;
  btnAddBootui.textContent = "Asked Copilot \u2713";
  await post("/api/fix", { kind: "install-bootui", module: moduleSelect.value });
};
btnAddDevtools.onclick = async () => {
  btnAddDevtools.disabled = true;
  btnAddDevtools.textContent = "Asked Copilot \u2713";
  await post("/api/fix", { kind: "install-devtools", module: moduleSelect.value });
};
btnSetupJdtls.onclick = async () => {
  btnSetupJdtls.disabled = true;
  btnSetupJdtls.textContent = "Asked Copilot \u2713";
  const j = jdtlsState || {};
  await post("/api/fix", {
    kind: "install-jdtls",
    reason: j.reason || null,
    os: (j.install && j.install.os) || null,
    installCmd: (j.install && j.install.cmd) || null,
    minJava: j.minJava || null,
    javaVersion: (j.java && j.java.version) || null,
    configFile: j.configFile || null,
  });
};

// Persist every setting (auto-saved on change). The backend reacts to
// devtools (live reload) changes.
function saveSettings() {
  post("/api/settings", {
    warm: warmInput.checked,
    springProfiles: springInput.value.trim(),
    devtools: devtoolsInput.checked,
    randomPort: randomportInput.checked,
    maskSecrets: maskSecretsInput ? maskSecretsInput.checked : true,
    metricsPollMs: metricsPollInput ? Number(metricsPollInput.value) || 2500 : 2500,
    openBrowser: openBrowserInput.checked,
    fullBuild: fullbuildInput.checked,
    buildClean: buildCleanInput.checked,
    packageClean: packageCleanInput.checked,
    packageInstall: packageInstallInput.checked,
    autoProfile: autoProfileInput ? autoProfileInput.checked : false,
    autoProfileEvent: flameEvent ? flameEvent.value : "cpu",
    autoProfileDuration: flameDuration ? Number(flameDuration.value) : 30,
    jdkHome: jdkSelect ? jdkSelect.value : "",
    asideTab: asideTabPref,
    asideOpen: asideOpenPref,
  });
}
warmInput.addEventListener("change", saveSettings);
devtoolsInput.addEventListener("change", saveSettings);
randomportInput.addEventListener("change", saveSettings);
if (maskSecretsInput) maskSecretsInput.addEventListener("change", saveSettings);
if (metricsPollInput) metricsPollInput.addEventListener("change", saveSettings);
openBrowserInput.addEventListener("change", saveSettings);
springInput.addEventListener("change", saveSettings);
if (jdkSelect) jdkSelect.addEventListener("change", saveSettings);
buildCleanInput.addEventListener("change", saveSettings);
packageCleanInput.addEventListener("change", saveSettings);
packageInstallInput.addEventListener("change", saveSettings);
if (autoProfileInput) autoProfileInput.addEventListener("change", saveSettings);
if (flameEvent) flameEvent.addEventListener("change", saveSettings);
if (flameDuration) flameDuration.addEventListener("change", saveSettings);

// Test-view filters (client-only): re-render the last report when the
// only-failures toggle or the search box changes. No server round-trip.
function rerenderTestFilter() {
  if (lastTestReportData) renderTests(lastTestReportData, lastTestRenderOpts);
}
if (failuresOnlyInput) failuresOnlyInput.addEventListener("change", rerenderTestFilter);
if (testSearchEl) testSearchEl.addEventListener("input", rerenderTestFilter);

// "Full build" persists the affected-vs-full-suite preference for the Test button.
fullbuildInput.addEventListener("change", () => {
  fullBuildSetting = fullbuildInput.checked === true;
  saveSettings();
});
// "Continuous testing" starts/stops the server-side watch loop. The endpoint
// returns the authoritative continuous state; apply it immediately (don't wait
// for the status SSE) so the Full build toggle re-enables and the Test button's
// affected/full decision is correct the instant the loop stops.
continuousInput.addEventListener("change", async () => {
  if (continuousInput.disabled) return;
  const res = await postJson("/api/test/continuous", {
    enabled: continuousInput.checked,
    mavenProfiles: mvnProfiles(),
  });
  if (res && res.continuous && statusSnap) {
    statusSnap.continuous = res.continuous;
    reflectTestToggles();
  }
});

btnFix.onclick = async () => {
  const kind = btnFix.dataset.kind;
  if (!kind) return;
  btnFix.disabled = true;
  btnFix.textContent = "Asked Copilot \u2713";
  await post("/api/fix", { kind });
};

mcpToggle.onclick = async () => {
  const enabled = mcpToggle.checked;
  mcpState.textContent = enabled ? "enabling\u2026" : "disabling\u2026";
  const r = await postJson("/api/mcp/toggle", { enabled });
  // Reflect the server's actual state from the toggle response.
  renderMcp((r && r.status) || null);
};

mcpRegisterBtn.onclick = async () => {
  mcpRegisterBtn.disabled = true;
  mcpRegisterBtn.textContent = "Asked Copilot \u2713";
  await post("/api/fix", { kind: "register-mcp" });
};

let lastRunnerLabel = null;
// Per-lane auto-switch: follow a lane to its tab the moment it enters its
// active phase (build→building, test→testing, run→running). Because each
// lane is tracked independently, a build finishing won't yank you off the
// Run tab, and starting a test while the app runs jumps to the Test tab.
const laneActivePhase = { build: "building", test: "testing", package: "packaging", run: "running", debug: "running" };
const laneWasActive = { build: false, test: false, package: false, run: false, debug: false };
function followLaneActivity(s) {
  if (!s) return;
  for (const op of ["build", "test", "package", "run", "debug"]) {
    const lane = s[op];
    if (!lane) continue;
    const active = lane.phase === laneActivePhase[op];
    if (active && !laneWasActive[op]) {
      showTab(op);
      if (op === "test") renderTests(null, { running: true });
    }
    laneWasActive[op] = active;
  }
}

const es = new EventSource(`/events?${qs}`);
es.addEventListener("console", (e) => {
  const d = JSON.parse(e.data);
  appendLine(d.line, d.stream, d.op);
});
es.addEventListener("status", (e) => {
  const s = JSON.parse(e.data);
  renderStatus(s);
  if (s && s.test) lastRunnerLabel = s.test.runnerLabel;
  followLaneActivity(s);
});
es.addEventListener("metrics", (e) => renderMetrics(JSON.parse(e.data)));
es.addEventListener("debug", (e) => {
  debugSnap = JSON.parse(e.data);
  renderDebug(debugSnap, statusSnap);
});
es.addEventListener("profile", (e) => renderProfileState(JSON.parse(e.data)));
es.addEventListener("test-progress", (e) => {
  renderTestProgress(JSON.parse(e.data));
});
es.addEventListener("tests", (e) => {
  const report = JSON.parse(e.data);
  renderTests(report, { runnerLabel: lastRunnerLabel });
});
es.addEventListener("tests-selection", (e) => {
  renderTestSelection(JSON.parse(e.data));
});
es.addEventListener("env", (e) => {
  // The backend resolves the project root in the background after startup; apply
  // the refreshed env so the build tool, modules, and banners update live.
  applyEnv(JSON.parse(e.data));
});
es.addEventListener("update", (e) => {
  // Self-update availability is checked ~1 min after launch and after a pull;
  // reflect it live so the "Update to latest version" button appears/hides.
  applyUpdateState(JSON.parse(e.data));
});
es.addEventListener("reset", (e) => {
  // Clear only the console for the op that's (re)starting; the others keep
  // their last output.
  let op = "build";
  try {
    op = (JSON.parse(e.data) || {}).op || "build";
  } catch {}
  const el = consoles[op];
  if (el) el.innerHTML = "";
  if (op === "run") {
    lastRunLevel = "INFO";
    updateLogCount();
  }
});

// Full-cover loading overlay: dismissed once the first /api/state lands (or a
// safety timeout fires) so the canvas never shows empty panels on open.
const loadingOverlay = document.getElementById("loading-overlay");
let loadingHidden = false;
function hideLoading() {
  if (loadingHidden || !loadingOverlay) return;
  loadingHidden = true;
  loadingOverlay.classList.add("hide");
  loadingOverlay.setAttribute("aria-hidden", "true");
  setTimeout(() => loadingOverlay.setAttribute("hidden", ""), 220);
}
setTimeout(hideLoading, 4000);

fetch(`/api/state?${qs}`)
  .then((r) => r.json())
  .then((s) => {
    debugSnap = s.debug || null;
    renderStatus(s.status);
    renderMetrics(s.metrics);
    applyEnv(s.env);
    renderDebug(debugSnap, s.status);
    if (s.profile) renderProfileState(s.profile);
    if (s.update) applyUpdateState(s.update);
    if (s.status && s.status.test) lastRunnerLabel = s.status.test.runnerLabel;
    renderTests(s.tests, { runnerLabel: lastRunnerLabel });
    for (const l of s.console || []) appendLine(l.line, l.stream, l.op);
    // Open the tab matching whatever the backend was last doing.
    followLaneActivity(s.status);
  })
  .catch(() => {})
  .finally(hideLoading);

// Env (mvnd availability, modules, profiles, capabilities) is only sampled
// at page load, so installing mvnd while the canvas is open would otherwise
// leave the "not installed" banner stale. Re-sample whenever the canvas
// regains focus / visibility so the toggle and banner self-heal.
function refreshEnv() {
  fetch(`/api/env?${qs}`)
    .then((r) => r.json())
    .then(applyEnv)
    .catch(() => {});
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshEnv();
});
window.addEventListener("focus", refreshEnv);

// "Check again": re-run project-root + build-tool detection on the backend, then
// re-apply the env. Lets a project that wasn't visible at startup recover without
// reloading the extension (applyEnv hides this banner once a tool is found).
if (btnRecheck) {
  btnRecheck.addEventListener("click", async () => {
    btnRecheck.disabled = true;
    btnRecheck.textContent = "Checking…";
    const env = await postJson("/api/recheck");
    applyEnv(env);
    btnRecheck.disabled = false;
    btnRecheck.textContent = "Check again";
    if (env && env.buildTool) {
      appendLine(`[canvas] detected ${env.toolLabel || env.buildTool} project.`, "stdout");
    } else {
      appendLine("[canvas] still no Maven or Gradle project detected.", "stderr");
    }
  });
}

// Header refresh button: re-run the full project discovery the extension does at
// launch (build tool, modules, Maven/Spring/Quarkus profiles, detected
// technologies) and re-apply it, without reloading the extension. Shares the
// /api/recheck backend with "Check again"; the spinning icon signals progress.
if (btnRefresh) {
  btnRefresh.addEventListener("click", async () => {
    if (btnRefresh.classList.contains("is-busy")) return;
    btnRefresh.classList.add("is-busy");
    btnRefresh.disabled = true;
    const env = await postJson("/api/recheck");
    if (env && !env.error) {
      applyEnv(env);
      appendLine(`[canvas] re-scanned project: ${env.toolLabel || env.buildTool || "no build tool"}.`, "stdout");
    } else {
      appendLine("[canvas] refresh failed" + (env && env.error ? `: ${env.error}` : "."), "stderr");
    }
    btnRefresh.classList.remove("is-busy");
    btnRefresh.disabled = false;
  });
}

// "Update to latest version": shown only when the extension is its own Coffilot
// git checkout that's behind its remote. Reflects the backend's update state —
// available, in-progress, or freshly updated (which needs a reload to take hold).
let updateApplied = false;
function applyUpdateState(u) {
  if (!btnUpdate) return;
  u = u || {};
  // Once a pull has succeeded this session, keep the "reload" prompt visible:
  // the new code only runs after the user reloads the extension, so don't revert
  // to a plain hidden/available state from a later background check.
  if (updateApplied) {
    btnUpdate.hidden = false;
    return;
  }
  if (btnUpdate.classList.contains("is-busy")) return; // mid-pull; leave the button as-is
  const show = !!u.available;
  btnUpdate.hidden = !show;
  if (show) {
    const n = u.behind || 0;
    const where = u.remoteRef ? ` on ${u.remoteRef}` : "";
    btnUpdate.title =
      n > 0
        ? `${n} new commit${n === 1 ? "" : "s"} available${where} — click to run "git pull"`
        : 'A newer version of Coffilot is available — click to run "git pull"';
  }
}

if (btnUpdate) {
  btnUpdate.addEventListener("click", async () => {
    if (updateApplied) return; // already pulled; waiting for a reload
    if (btnUpdate.classList.contains("is-busy")) return;
    btnUpdate.classList.add("is-busy");
    btnUpdate.disabled = true;
    const labelEl = btnUpdate.querySelector(".update-btn-label");
    const prevLabel = labelEl ? labelEl.textContent : "";
    if (labelEl) labelEl.textContent = "Updating…";
    const res = await postJson("/api/update");
    btnUpdate.classList.remove("is-busy");
    if (res && res.ok) {
      updateApplied = true;
      // Keep the button visible and enabled as a persistent "reload to finish"
      // reminder: the pulled code only runs once the extension is reloaded, so a
      // greyed-out (disabled) button here reads as if the action vanished.
      btnUpdate.disabled = false;
      btnUpdate.hidden = false;
      if (labelEl) labelEl.textContent = "Restart to finish update";
      btnUpdate.title = "Coffilot was updated on disk. Reload the Copilot extensions and re-open this canvas.";
    } else {
      const err = (res && (res.error || res.output)) || "unknown error";
      btnUpdate.disabled = false;
      if (labelEl) labelEl.textContent = prevLabel || "New version available";
      btnUpdate.title = "Update failed: " + err;
    }
  });
}

// The iframe can't open a browser via target="_blank"; route external
// http(s) links through the backend opener instead.
document.addEventListener("click", (e) => {
  const a = e.target.closest && e.target.closest('a[href^="http"]');
  if (!a) return;
  e.preventDefault();
  post("/api/open-url", { url: a.href });
});

// ---------------------------------------------------------------------------
// Run tab: async-profiler flame graph
// ---------------------------------------------------------------------------
let profilerEnv = null; // env.profiler capability snapshot
let runActive = false; // app currently running (run lane busy / has a port)
let profileState = { status: "idle" };
let lastFlameFinishedAt = 0;
let flameRootNode = null; // full tree root from the last run
let flameZoomNode = null; // currently displayed (zoomed) subtree root
let flameTotal = 0; // grand-total samples (for absolute %)
const profileSpin = btnProfile && btnProfile.querySelector(".btn-spin");

const EVENT_LABELS = { cpu: "CPU", alloc: "allocations", wall: "wall clock", lock: "lock contention" };
const eventLabel = (e) => EVENT_LABELS[e] || e || "CPU";
const fmtInt = (n) => Number(n || 0).toLocaleString();

// Enable Record only when async-profiler is available AND the app is running AND
// no run is already in flight.
function updateProfileButton() {
  if (!btnProfile) return;
  const avail = !!(profilerEnv && profilerEnv.available && profilerEnv.supported);
  const running = profileState.status === "running";
  btnProfile.disabled = !avail || !runActive || running;
  btnProfile.title = !avail
    ? "async-profiler isn't available"
    : !runActive
      ? "Start the app with Run before recording a flame graph"
      : running
        ? "A profiling run is already in progress"
        : "Record a flame graph from the running app";
}

// Show / hide the install banner and gate the controls on the profiler snapshot.
function applyProfilerEnv(p) {
  profilerEnv = p || null;
  const supported = !!(p && p.supported);
  const available = !!(p && p.available);
  if (flameUnavailable) {
    if (!supported) {
      flameUnavailable.hidden = false;
      flameMsg.textContent =
        "Flame graphs aren't available: async-profiler has no Windows build, and the JDK's JFR tools (jcmd) weren't found. Install a JDK (or set JAVA_HOME) to enable the JFR fallback.";
      flameCmd.hidden = true;
      flameDocs.href = (p && p.install && p.install.url) || "https://github.com/async-profiler/async-profiler";
    } else if (!available) {
      flameUnavailable.hidden = false;
      const inst = (p && p.install) || {};
      const os = inst.os ? ` on ${inst.os}` : "";
      flameMsg.innerHTML =
        `<strong>async-profiler</strong> isn't installed${os}, and no JDK <code>jcmd</code> was found for the JFR fallback, so flame graphs are disabled. ` +
        (inst.cmd
          ? "Install async-profiler to enable them:"
          : "Install async-profiler or a JDK (and reopen the canvas) to enable them:");
      if (inst.cmd) {
        flameCmd.textContent = inst.cmd;
        flameCmd.hidden = false;
      } else {
        flameCmd.hidden = true;
      }
      flameDocs.href = inst.url || "https://github.com/async-profiler/async-profiler";
    } else {
      flameUnavailable.hidden = true;
    }
  }
  updateProfileButton();
}

// Apply a profile-state snapshot (from SSE `profile` or /api/state). Drives the
// status line, the Stop button, the Record spinner, and triggers a data fetch
// when a run completes.
function renderProfileState(p) {
  if (!p) return;
  profileState = p;
  const running = p.status === "running";
  if (btnProfileStop) btnProfileStop.hidden = !running;
  if (profileSpin) profileSpin.hidden = !running;
  if (flameStatus) {
    if (running) {
      const eng = p.engine === "jfr" ? " · JFR" : "";
      flameStatus.textContent = `Sampling ${eventLabel(p.event)}${p.pid ? ` (pid ${p.pid})` : ""} for ${p.duration}s${eng}\u2026`;
      flameStatus.className = "muted";
    } else if (p.status === "done") {
      const eng = p.engine === "jfr" ? " \u00b7 JFR" : "";
      flameStatus.textContent = `${fmtInt(p.total)} samples \u00b7 ${eventLabel(p.event)} \u00b7 ${p.duration}s${eng}`;
      flameStatus.className = "muted ok";
    } else if (p.status === "error") {
      flameStatus.textContent = p.error || "Profiling failed.";
      flameStatus.className = "muted err";
    } else {
      flameStatus.textContent = "";
      flameStatus.className = "muted";
    }
  }
  updateProfileButton();
  if (p.status === "done" && p.hasGraph && p.finishedAt && p.finishedAt !== lastFlameFinishedAt) {
    lastFlameFinishedAt = p.finishedAt;
    fetchFlameData();
  }
}

async function fetchFlameData() {
  try {
    const r = await fetch(`/api/profile/data?${qs}`);
    const d = await r.json();
    if (d && d.flame) renderFlameData(d);
  } catch {
    /* leave the previous graph in place */
  }
}

function renderFlameData(d) {
  flameRootNode = d.flame;
  flameZoomNode = flameRootNode;
  flameTotal = d.total || (d.flame && d.flame.v) || 0;
  if (flameEmpty) flameEmpty.hidden = true;
  if (flameGraph) flameGraph.hidden = false;
  if (flameSearch) flameSearch.hidden = false;
  if (btnFlameReset) btnFlameReset.hidden = false;
  if (btnFlameFix) btnFlameFix.hidden = false;
  renderFlame();
  renderHotspots(d.top || []);
}

// Warm-hued, stable per-frame colour (orange→yellow) derived from the name hash.
function frameColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = 12 + (h % 42); // 12..53: reds → oranges → yellows
  const sat = 72 + (h % 14); // 72..85%
  const lig = 48 + (h % 12); // 48..59%
  return `hsl(${hue} ${sat}% ${lig}%)`;
}

const FLAME_ROW = 22;
// Lay out the current (zoom) subtree as absolutely-positioned divs: width is the
// fraction of the zoom root's samples, top is depth * row height.
function renderFlame() {
  if (!flameZoomNode || !flameGraph) return;
  const total = flameZoomNode.v || 1;
  const q = (flameSearch && flameSearch.value.trim().toLowerCase()) || "";
  const rows = [];
  let maxDepth = 0;
  (function layout(node, depth, x0) {
    if (depth > maxDepth) maxDepth = depth;
    rows.push({ node, depth, x: x0, w: node.v / total });
    let cx = x0;
    for (const ch of node.c || []) {
      layout(ch, depth + 1, cx);
      cx += ch.v / total;
    }
  })(flameZoomNode, 0, 0);
  flameGraph.style.height = (maxDepth + 1) * FLAME_ROW + "px";
  const frag = document.createDocumentFragment();
  for (const f of rows) {
    const div = document.createElement("div");
    div.className = "flame-frame";
    div.style.left = (f.x * 100).toFixed(4) + "%";
    div.style.width = Math.max(0, f.w * 100).toFixed(4) + "%";
    div.style.top = f.depth * FLAME_ROW + "px";
    div.style.background = frameColor(f.node.n);
    if (q && f.node.n.toLowerCase().includes(q)) div.classList.add("match");
    const span = document.createElement("span");
    span.textContent = f.node.n;
    div.appendChild(span);
    div.title = f.node.n;
    div.onclick = () => {
      flameZoomNode = f.node;
      renderFlame();
    };
    div.onmouseenter = () => showFrameInfo(f.node);
    frag.appendChild(div);
  }
  flameGraph.replaceChildren(frag);
}

function showFrameInfo(node) {
  if (!flameInfo) return;
  flameInfo.hidden = false;
  const pct = flameTotal ? (node.v / flameTotal) * 100 : 0;
  flameInfo.innerHTML = `<code>${esc(node.n)}</code> &middot; ${fmtInt(node.v)} samples (${pct.toFixed(2)}%)`;
}

function renderHotspots(top) {
  if (!flameHotspots) return;
  if (!top.length) {
    flameHotspots.innerHTML = "";
    return;
  }
  const rows = top
    .map((h) => {
      const pct = (h.pct * 100).toFixed(1);
      const bar = Math.min(100, h.pct * 100).toFixed(1);
      return (
        `<div class="hot"><span class="hot-bar" style="width:${bar}%"></span>` +
        `<span class="hot-name" title="${esc(h.name)}">${esc(h.name)}</span>` +
        `<span class="hot-pct">${pct}%</span></div>`
      );
    })
    .join("");
  flameHotspots.innerHTML = `<div class="hot-head">Top self-time hotspots</div>${rows}`;
}

// Start a profiling run using the currently-selected event + duration (the manual
// Record button). Auto-record at startup is handled by the backend.
async function startProfileRun() {
  const event = flameEvent ? flameEvent.value : "cpu";
  const duration = (flameDuration && Number(flameDuration.value)) || 30;
  if (flameStatus) {
    flameStatus.textContent = "Starting\u2026";
    flameStatus.className = "muted";
  }
  const r = await postJson("/api/profile", { event, duration });
  if (r && r.ok === false && r.error && flameStatus) {
    flameStatus.textContent = r.error;
    flameStatus.className = "muted err";
  }
}

if (btnProfile) btnProfile.onclick = () => startProfileRun();
if (btnProfileStop) btnProfileStop.onclick = () => post("/api/profile/stop", {});
if (btnFlameReset)
  btnFlameReset.onclick = () => {
    if (!flameRootNode) return;
    flameZoomNode = flameRootNode;
    renderFlame();
  };
if (flameSearch) flameSearch.oninput = () => renderFlame();
if (btnFlameFix)
  btnFlameFix.onclick = () => {
    post("/api/fix", { kind: "profile" });
    appendLine("[canvas] asked Copilot to analyze the flame-graph hotspots.", "stdout", "run");
  };
