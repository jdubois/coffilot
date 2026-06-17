const params = new URLSearchParams(location.search);
const instance = params.get("instance");
const token = params.get("token");
const qs = `instance=${encodeURIComponent(instance)}&token=${encodeURIComponent(token)}`;

const buildConsoleEl = document.getElementById("build-console");
const packageConsoleEl = document.getElementById("package-console");
const testConsoleEl = document.getElementById("test-console");
const runConsoleEl = document.getElementById("run-console");
const consoles = { build: buildConsoleEl, package: packageConsoleEl, test: testConsoleEl, run: runConsoleEl };
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
const btnTestAffected = document.getElementById("btn-test-affected");
const btnTestAffectedSpin = document.querySelector("#btn-test-affected .btn-spin");
const testSelectionEl = document.getElementById("test-selection");
const warmToggle = document.getElementById("warm-toggle");
const warmInput = document.getElementById("in-warm");
const warmLabel = document.getElementById("warm-label");
const warmInfo = document.getElementById("warm-info");
const moduleSelect = document.getElementById("in-module");
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
const openBrowserInput = document.getElementById("in-openbrowser");
const btnOpenBrowser = document.getElementById("btn-open-browser");
const btnFix = document.getElementById("btn-fix");
const btnStopMaven = document.getElementById("btn-stop-maven");
const btnStopRun = document.getElementById("btn-stop-run");
const btnRun = document.getElementById("btn-run");
// Running spinners on each trigger button and tab. The Test tab keeps its
// badge/progress feedback too; the spinner shows only while the run is busy.
const btnSpin = {
  build: document.querySelector("#btn-build .btn-spin"),
  test: document.querySelector("#btn-test .btn-spin"),
  package: document.querySelector("#btn-package .btn-spin"),
  run: document.querySelector("#btn-run .btn-spin"),
};
const tabSpin = {
  build: document.querySelector('.tab[data-tab="build"] .tab-spin'),
  test: document.querySelector('.tab[data-tab="test"] .tab-spin'),
  package: document.querySelector('.tab[data-tab="package"] .tab-spin'),
  run: document.querySelector('.tab[data-tab="run"] .tab-spin'),
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
};
const capsEl = document.getElementById("caps");
const metricsSrc = document.getElementById("metrics-src");
const metricsHint = document.getElementById("metrics-hint");
const mcpToggle = document.getElementById("mcp-toggle");
const mcpToggleLabel = document.getElementById("mcp-toggle-label");
const mcpState = document.getElementById("mcp-state");
const mcpScansEl = document.getElementById("mcp-scans");
const mcpResultEl = document.getElementById("mcp-result");
const mcpRegisterBtn = document.getElementById("mcp-register");
let caps = {};
// Whether a Maven/Gradle build tool is present. When false the canvas runs
// in degraded mode: Build/Test/Package/Run stay disabled.
let toolPresent = true;
// Last JDTLS availability snapshot (env.jdtls), used for the toolchain pill.
let jdtlsState = {};

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
    .replace(/>/g, "&gt;");
}

// Main tabs (Build / Test / Package / Run)
function showTab(name) {
  if (!consoles[name]) return;
  activeTab = name;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  document.getElementById("build-console").classList.toggle("active", name === "build");
  document.getElementById("package-console").classList.toggle("active", name === "package");
  document.getElementById("test-pane").classList.toggle("active", name === "test");
  document.getElementById("run-pane").classList.toggle("active", name === "run");
  // The header (phase/command/exit/fix) follows the active tab, so
  // re-render it for the newly shown lane from the last status snapshot.
  if (statusSnap) renderLaneHeader(statusSnap[name] || {});
}
document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => showTab(t.dataset.tab)));

// Test tab: Graphical / Console sub-toggle (graphical is the default).
function showTestView(view) {
  document.querySelectorAll(".subtab").forEach((t) => t.classList.toggle("active", t.dataset.tview === view));
  document.getElementById("tests").classList.toggle("active", view === "graphical");
  document.getElementById("test-console").classList.toggle("active", view === "console");
}
document.querySelectorAll(".subtab").forEach((t) => (t.onclick = () => showTestView(t.dataset.tview)));

// Aside sub-tabs (Live JVM Metrics / Settings)
function showAsideTab(name) {
  document.querySelectorAll(".atab").forEach((t) => t.classList.toggle("active", t.dataset.atab === name));
  document.getElementById("atab-metrics").classList.toggle("active", name === "metrics");
  document.getElementById("atab-settings").classList.toggle("active", name === "settings");
}
document.querySelectorAll(".atab").forEach((t) => (t.onclick = () => showAsideTab(t.dataset.atab)));

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
  if (stream === "stderr") span.className = "err";
  span.textContent = line + "\n";
  el.appendChild(span);
  while (el.childNodes.length > 2000) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}

// Last status snapshot ({ build, test, package, run, reload }).
// (declared above, near activeTab, so showTab can read it)

// Optimistic "stopping" state for the two grouped Stop buttons. A stop request
// is fire-and-forget, and the lane only reports !busy once the child process
// actually dies (which can take a few seconds for a server). Without local
// feedback the button looks dead, so we flip it to a disabled "Stopping…"
// spinner the moment it's clicked and clear it when the lane goes idle (or a
// safety timeout fires, in case the process ignores the stop and the user
// needs to retry).
const stopping = { maven: false, run: false };
const stopTimers = { maven: null, run: null };

function markStopping(which, op) {
  if (stopping[which]) return;
  stopping[which] = true;
  appendLine(`[canvas] stopping ${which === "run" ? "the app" : "the build"}\u2026`, "stdout", op);
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

function applyStopButton(btn, which, busy) {
  // The process has actually stopped: drop the optimistic state.
  if (stopping[which] && !busy) clearStopping(which);
  const isStopping = stopping[which];
  btn.disabled = !busy || isStopping;
  btn.classList.toggle("is-stopping", isStopping);
  const spin = btn.querySelector(".btn-spin");
  if (spin) spin.hidden = !isStopping;
  const label = btn.querySelector(".btn-label");
  if (label) label.textContent = isStopping ? "Stopping\u2026" : "Stop";
  if (isStopping) {
    btn.title = which === "run" ? "Stopping the app\u2026" : "Stopping the build\u2026";
  } else if (busy) {
    btn.title = which === "run" ? "Stop the running app" : "Stop the running build, test or package";
  } else {
    btn.title = which === "run" ? "The app isn't running" : "No build is running";
  }
}

// Optimistic "restarting" state for the trigger buttons. Clicking a trigger
// while its lane is busy stops the running process and relaunches it; the lane
// briefly reports idle/failed between the two, so we mask that transition until
// the new run reports busy. Two phases: "stopping" (waiting for the old process
// to exit) flips to "starting" the first time the lane reports not-busy, then
// clears once the relaunch reports busy. A safety timeout is the backstop in
// case the restart never starts (e.g. it timed out server-side).
const restarting = { build: false, test: false, package: false, run: false };
const restartTimers = { build: null, test: null, package: null, run: null };

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
  for (const op of ["build", "test", "package", "run"]) {
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
  // The two grouped Stop buttons are global, not tied to the active tab:
  // the Maven Stop covers build/test/package; the Run Stop covers run.
  const mvnBusy = laneActive(s, "build") || laneActive(s, "test") || laneActive(s, "package");
  applyStopButton(btnStopMaven, "maven", mvnBusy);
  applyStopButton(btnStopRun, "run", laneActive(s, "run"));
  // Per-lane spinners on the trigger buttons and tabs (global, so they reflect
  // activity regardless of which tab is showing). The `is-restarting` class
  // turns the trigger's spinner into a rotating restart glyph without touching
  // the label, so the button keeps its width.
  for (const op of ["build", "test", "package", "run"]) {
    const active = laneActive(s, op);
    if (btnSpin[op]) btnSpin[op].hidden = !active;
    if (tabSpin[op]) tabSpin[op].hidden = !active;
    if (triggerButton[op]) {
      triggerButton[op].classList.toggle("is-restarting", !!restarting[op]);
    }
  }
  // While a build op runs the lane is serialized, so grey out the other
  // Build/Test/Package buttons (the running one stays active — click it again
  // to restart). Everything is disabled when no build tool is present.
  const busyMvnOp = ["build", "test", "package"].find((op) => laneActive(s, op));
  for (const op of ["build", "test", "package"]) {
    const btn = mvnButtons[op];
    if (!btn) continue;
    // The running op stays clickable (to restart); idle siblings are greyed out
    // until it stops, and the op itself is locked while its restart is in flight.
    btn.disabled = !toolPresent || (!!busyMvnOp && op !== busyMvnOp) || !!restarting[op];
    btn.title = !toolPresent
      ? "Coffilot needs a Maven or Gradle project."
      : restarting[op]
        ? "Restarting\u2026"
        : op === busyMvnOp
          ? `Restart the running ${op}`
          : btn.disabled
            ? `Stop the running ${busyMvnOp} first`
            : "";
  }
  // "Run affected" shares the serialized Maven lane; spinner follows the test lane.
  if (btnTestAffected) {
    const testBusy = !!(s.test && s.test.busy);
    btnTestAffected.disabled = !toolPresent || (!!busyMvnOp && !testBusy);
    btnTestAffected.title = !toolPresent
      ? "Coffilot needs a Maven or Gradle project."
      : btnTestAffected.disabled
        ? `Stop the running ${busyMvnOp} first`
        : "Run only the tests affected by your uncommitted changes vs HEAD (Infinitest-style)";
    if (btnTestAffectedSpin) btnTestAffectedSpin.hidden = !testBusy;
  }
  if (!toolPresent) btnRun.disabled = true;
  else btnRun.disabled = !!restarting.run;
  if (toolPresent) {
    btnRun.title = restarting.run ? "Restarting\u2026" : laneActive(s, "run") ? "Restart the running app" : "";
  }
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
    btnFix.hidden = false;
    btnFix.disabled = false;
    btnFix.dataset.kind = l.fix.kind;
    btnFix.textContent = l.fix.label || "Fix with Copilot";
  } else {
    btnFix.hidden = true;
    btnFix.dataset.kind = "";
  }
}

function mb(bytes) {
  return bytes == null ? "?" : Math.round(bytes / 1048576) + " MB";
}
function row(k, v) {
  return `<div class="metric"><span class="k">${k}</span><span class="v">${v}</span></div>`;
}

function renderMetrics(m) {
  if (!m || !m.appUp) {
    metricsSrc.hidden = true;
    renderMcp(null);
    metricsEl.innerHTML =
      '<p class="muted">App not running. Click <strong>Run</strong> to start it (Spring\u2019s <code>dev</code> profile activates BootUI).</p>';
    metricsHint.innerHTML =
      "Run a Spring Boot app with the <code>dev</code> profile for rich BootUI metrics, a Quarkus app for Micrometer metrics, or anything exposing Actuator for a subset.";
    return;
  }
  const tier = m.metricsTier || "process";
  metricsSrc.hidden = false;
  metricsSrc.className = "src " + tier;
  metricsSrc.textContent =
    tier === "bootui" ? "BootUI" : tier === "actuator" ? "Actuator" : tier === "quarkus" ? "Quarkus" : "process";

  if (tier === "process") {
    metricsEl.innerHTML =
      '<p class="muted">App is running, but no <code>/bootui/api</code>, <code>/actuator</code> or <code>/q/metrics</code> endpoint answered, so live JVM metrics aren\u2019t available.</p>';
    metricsHint.innerHTML =
      "Add <code>spring-boot-starter-actuator</code> / BootUI (Spring) or <code>quarkus-micrometer-registry-prometheus</code> (Quarkus) to surface heap, threads and health here.";
    renderMcp(null);
    return;
  }

  const o = m.overview || {};
  const heap = (m.memory && m.memory.heap) || {};
  const nonHeap = (m.memory && m.memory.nonHeap) || {};
  const pct = heap.usedPercent != null ? heap.usedPercent : 0;
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
    html += `<div class="bar"><div style="width:${Math.min(100, pct)}%"></div></div>`;
    html += row("Heap used", `${mb(heap.usedBytes)} / ${mb(heap.maxBytes)} (${pct}%)`);
  }
  if (nonHeap.usedBytes != null) html += row("Non-heap used", mb(nonHeap.usedBytes));
  metricsEl.innerHTML = html || '<p class="muted">No metrics reported.</p>';

  if (tier === "bootui") {
    metricsHint.innerHTML =
      "Rich metrics read from the running app\u2019s <code>/bootui/api/**</code> endpoints \u2014 reused directly from BootUI.";
    renderMcp(m.mcp);
  } else if (tier === "quarkus") {
    metricsHint.innerHTML =
      "Metrics read from Quarkus Micrometer (<code>/q/metrics</code>) and SmallRye Health (<code>/q/health</code>).";
    renderMcp(null);
  } else {
    metricsHint.innerHTML =
      "Metrics normalized from Spring Boot <code>/actuator/**</code>. Add BootUI for advisor scans and richer detail.";
    renderMcp(null);
  }
}

// ---- BootUI MCP server panel ------------------------------------------
let mcpScansLoaded = false;

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
// actionable while a BootUI app (dev profile) exposes its endpoint. The
// row stays visible in Settings either way; when unavailable we grey out
// the switch and explain why instead of hiding it.
function setMcpUnavailable() {
  mcpScansLoaded = false;
  mcpToggle.checked = false;
  mcpToggle.disabled = true;
  mcpToggleLabel.classList.add("disabled");
  mcpState.textContent = "";
  showMcpRegister(false);
  mcpScansEl.innerHTML =
    '<span class="muted" style="font-size:12px">Start a BootUI app (dev profile) with <strong>Run</strong> to manage its MCP server and advisor scans.</span>';
  mcpResultEl.innerHTML = "";
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
  if (!enabled) {
    mcpScansLoaded = false;
    mcpScansEl.innerHTML = '<span class="muted" style="font-size:12px">Enable the server to run advisor scans.</span>';
    return;
  }
  if (!mcpScansLoaded) loadMcpScans();
}

async function getJson(path) {
  try {
    const r = await fetch(`${path}?${qs}`);
    return await r.json();
  } catch (e) {
    return { error: e.message };
  }
}

async function loadMcpScans() {
  const st = await getJson("/api/mcp/status");
  if (!st || !st.available) {
    setMcpUnavailable();
    return;
  }
  mcpToggle.disabled = false;
  mcpToggleLabel.classList.remove("disabled");
  const enabled = st.enabled === true;
  mcpToggle.checked = enabled;
  mcpState.textContent = "";
  showMcpRegister(enabled);
  const scans = (st && st.scans) || [];
  if (!enabled) {
    mcpScansLoaded = false;
    mcpScansEl.innerHTML = '<span class="muted" style="font-size:12px">Enable the server to run advisor scans.</span>';
    return;
  }
  mcpScansLoaded = true;
  if (!scans.length) {
    mcpScansEl.innerHTML = '<span class="muted" style="font-size:12px">No advisor scans advertised.</span>';
    return;
  }
  mcpScansEl.innerHTML = scans
    .map((s) => {
      const label = esc(s.name.replace(/_scan$/, "").replace(/_/g, " "));
      return `<button class="tiny" data-scan="${esc(s.name)}" title="${esc(s.description || s.name)}">${label}</button>`;
    })
    .join("");
  mcpScansEl.querySelectorAll("button[data-scan]").forEach((b) => (b.onclick = () => runScan(b.dataset.scan)));
}

async function runScan(tool) {
  mcpResultEl.innerHTML = `<span class="muted">Running ${esc(tool)}\u2026</span>`;
  const r = await postJson("/api/mcp/scan", { tool });
  if (!r || r.ok === false) {
    mcpResultEl.innerHTML = `<span style="color:var(--true-color-red,#cf222e)">Scan failed: ${esc((r && r.error) || "unknown error")}</span>`;
    return;
  }
  lastScan = { tool, result: r.result };
  const text = typeof r.result === "string" ? r.result : JSON.stringify(r.result, null, 2);
  mcpResultEl.innerHTML =
    `<div style="display:flex;align-items:center;gap:0.5rem;justify-content:space-between">` +
    `<strong>${esc(tool)}</strong>` +
    `<button class="fix tiny" id="mcp-send">Fix findings with Copilot</button></div>` +
    `<pre>${esc(text)}</pre>`;
  const send = document.getElementById("mcp-send");
  if (send)
    send.onclick = async () => {
      send.disabled = true;
      send.textContent = "Sent to Copilot \u2713";
      await post("/api/fix", { kind: "mcp", tool: lastScan.tool, result: lastScan.result });
    };
}
let lastScan = null;

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

function renderTests(report, opts) {
  opts = opts || {};
  if (report === null && opts.running) {
    testsEl.innerHTML = '<p class="empty">Running tests\u2026</p>';
    tabBadge.hidden = true;
    return;
  }
  if (!report) {
    testsEl.innerHTML = '<p class="empty">No test run yet. Click <strong>Test</strong> to run the suite.</p>';
    tabBadge.hidden = true;
    return;
  }
  const s = report.summary;
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
    return;
  }

  for (const suite of report.suites) {
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

// Infinitest-style affected-test selection banner. `sel` is the server's
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
  let txt = `Infinitest-style: ${n} test class${n === 1 ? "" : "es"} affected by ${files} changed source${files === 1 ? "" : "s"} vs HEAD`;
  if (sel.fallback) txt += " · name-based (run Build for dependency-accurate selection)";
  testSelectionEl.hidden = false;
  testSelectionEl.className = "test-selection" + (n ? "" : " warn");
  testSelectionEl.textContent = txt;
}

function hideTestSelection() {
  if (testSelectionEl) testSelectionEl.hidden = true;
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

  // Relabel the run-profile combo and swap its suggestions for the framework.
  if (lblProfiles) lblProfiles.textContent = quarkus ? "Quarkus profile" : "Spring Boot profiles";
  profileItems = quarkus ? quarkusItems : springItems;

  const showBootui = spring && !mod.bootui;
  btnAddBootui.hidden = !showBootui;
  if (showBootui) {
    btnAddBootui.disabled = false;
    btnAddBootui.textContent = caps.gradle ? "Add BootUI (developmentOnly)" : "Add BootUI to dev profile";
  }

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
  openBrowserInput.checked = s.openBrowser === true;
  if (document.activeElement !== springInput && typeof s.springProfiles === "string") {
    springInput.value = s.springProfiles;
  }
}

function applyEnv(env) {
  moduleList = (env && env.modules) || [];
  populateModules(env && env.modules);
  applyJdtls(env && env.jdtls);
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
  for (const op of ["build", "test", "package"]) {
    if (mvnButtons[op]) mvnButtons[op].disabled = !toolPresent;
  }
  if (statusSnap) renderStatus(statusSnap);

  // Maven profiles are Maven-only; hide the control for Gradle / no tool.
  const profilesSupported = !!(env && env.profilesSupported);
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
  html += pill(
    "JDTLS",
    !!jdtlsState.available,
    jdtlsState.available
      ? "Eclipse JDT Language Server is available — Copilot has Java code intelligence."
      : "JDTLS (Java code intelligence) isn't available; set it up from Settings.",
  );
  capsEl.innerHTML = html;
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

const warm = () => warmInput.checked === true;
const mvnProfiles = () => mvnProfilesInput.value.trim();

setupCombo(springInput, springMenu, () => profileItems);
setupCombo(mvnProfilesInput, mavenMenu, () => mavenItems);

// Each trigger button starts its lane, or — if that lane is already busy —
// restarts it (stop the current process, then relaunch with the same inputs).
function triggerLane(op, startPath, body) {
  if (restarting[op]) return; // a restart is already in flight (either phase)
  const busy = op === "run" ? laneBusy("run") : laneBusy("build") || laneBusy("test") || laneBusy("package");
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

document.getElementById("btn-build").onclick = () => {
  showTab("build");
  triggerLane("build", "/api/build", { warm: warm(), mavenProfiles: mvnProfiles() });
};
document.getElementById("btn-test").onclick = () => {
  showTab("test");
  hideTestSelection();
  triggerLane("test", "/api/test", { warm: warm(), mavenProfiles: mvnProfiles() });
};
if (btnTestAffected) {
  btnTestAffected.onclick = () => {
    if (btnTestAffected.disabled) return;
    showTab("test");
    post("/api/test", { affected: true, warm: warm(), mavenProfiles: mvnProfiles() });
  };
}
document.getElementById("btn-package").onclick = () => {
  showTab("package");
  triggerLane("package", "/api/package", { warm: warm(), mavenProfiles: mvnProfiles() });
};
document.getElementById("btn-run").onclick = () => {
  showTab("run");
  triggerLane("run", "/api/run", {
    module: document.getElementById("in-module").value.trim(),
    profiles: document.getElementById("in-profiles").value.trim(),
    mavenProfiles: mvnProfiles(),
  });
};
// Two grouped Stop buttons: the Maven Stop kills the shared build/test/
// package lane; the Run Stop kills the independent app. They are global,
// so you can stop a build without killing the running app, or vice versa.
btnStopMaven.onclick = () => {
  if (btnStopMaven.disabled) return;
  const s = statusSnap || {};
  const op = ["build", "test", "package"].find((o) => s[o] && s[o].busy) || activeTab;
  // A Stop wins over any in-flight restart of the build group.
  ["build", "test", "package"].forEach(clearRestarting);
  markStopping("maven", op);
  post("/api/stop", { op: "maven" });
};
btnStopRun.onclick = () => {
  if (btnStopRun.disabled) return;
  clearRestarting("run");
  markStopping("run", "run");
  post("/api/stop", { op: "run" });
};

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
    openBrowser: openBrowserInput.checked,
  });
}
warmInput.addEventListener("change", saveSettings);
devtoolsInput.addEventListener("change", saveSettings);
randomportInput.addEventListener("change", saveSettings);
openBrowserInput.addEventListener("change", saveSettings);
springInput.addEventListener("change", saveSettings);

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
  mcpScansLoaded = false;
  await post("/api/mcp/toggle", { enabled });
  // Reflect the server's actual state and (re)load advisor scans.
  loadMcpScans();
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
const laneActivePhase = { build: "building", test: "testing", package: "packaging", run: "running" };
const laneWasActive = { build: false, test: false, package: false, run: false };
function followLaneActivity(s) {
  if (!s) return;
  for (const op of ["build", "test", "package", "run"]) {
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
es.addEventListener("reset", (e) => {
  // Clear only the console for the op that's (re)starting; the others keep
  // their last output.
  let op = "build";
  try {
    op = (JSON.parse(e.data) || {}).op || "build";
  } catch {}
  const el = consoles[op];
  if (el) el.innerHTML = "";
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
    renderStatus(s.status);
    renderMetrics(s.metrics);
    applyEnv(s.env);
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

// The iframe can't open a browser via target="_blank"; route external
// http(s) links through the backend opener instead.
document.addEventListener("click", (e) => {
  const a = e.target.closest && e.target.closest('a[href^="http"]');
  if (!a) return;
  e.preventDefault();
  post("/api/open-url", { url: a.href });
});
