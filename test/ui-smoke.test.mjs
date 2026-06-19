// Smoke test for the iframe UI: load public/index.html into jsdom, execute
// public/app.js against it with stubbed network globals (EventSource / fetch),
// and assert the key render functions run on representative payloads without
// throwing. This catches parse errors and obvious render regressions in the
// client without a live canvas. Manual verification in a real canvas is still
// expected for UI changes (see CONTRIBUTING.md).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(path.join(root, "public", "index.html"), "utf8");
const appJs = readFileSync(path.join(root, "public", "app.js"), "utf8");

let dom;
let win;

before(() => {
  dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "http://127.0.0.1/?instance=test&token=test",
    pretendToBeVisual: true,
  });
  win = dom.window;

  // Stub the network surface app.js touches at load: an EventSource (the SSE
  // stream) and fetch (initial /api/state + settings). Neither should do real
  // I/O in the test.
  win.EventSource = class {
    constructor() {
      this.readyState = 0;
    }
    addEventListener() {}
    removeEventListener() {}
    close() {}
  };
  win.fetch = () =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => "",
    });
  // jsdom does not implement matchMedia; app.js queries it for theme/layout.
  win.matchMedia = () => ({
    matches: false,
    media: "",
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });

  // Execute app.js exactly as the browser would: as an inline classic script in
  // the window's global scope, so its top-level `function` declarations become
  // window globals we can call below.
  const script = win.document.createElement("script");
  script.textContent = appJs;
  win.document.body.appendChild(script);
});

after(() => {
  if (win) win.close();
});

test("app.js parses and defines the key render globals", () => {
  for (const fn of ["renderStatus", "renderMetrics", "renderMcp", "renderTests"]) {
    assert.equal(typeof win[fn], "function", `${fn} should be a global function`);
  }
});

test("renderMetrics handles the 'app down' and a populated Quarkus payload", () => {
  assert.doesNotThrow(() => win.renderMetrics(null));
  assert.doesNotThrow(() => win.renderMetrics({ appUp: false }));
  assert.doesNotThrow(() =>
    win.renderMetrics({
      appUp: true,
      metricsTier: "quarkus",
      overview: { javaVersion: "21", activeProfiles: ["dev"], startupTimeMillis: 3500 },
      memory: { heap: { usedBytes: 3000, maxBytes: 10000, usedPercent: 30 }, nonHeap: { usedBytes: 500 } },
      health: { status: "UP" },
      threads: { totalThreads: 12, daemonThreads: 8 },
    }),
  );
  // The heap bar should have rendered for the populated payload.
  assert.ok(win.document.getElementById("metrics").innerHTML.includes("Heap"));

  // Health-only Quarkus (smallrye-health, no Micrometer): the per-check breakdown
  // shows, and the hint points the user at quarkus-micrometer-registry-prometheus.
  assert.doesNotThrow(() =>
    win.renderMetrics({
      appUp: true,
      metricsTier: "quarkus",
      overview: {},
      memory: null,
      health: {
        status: "DOWN",
        checks: [
          { name: "Database connections health check", status: "UP" },
          { name: "messaging liveness", status: "DOWN" },
        ],
      },
      threads: null,
    }),
  );
  const healthHtml = win.document.getElementById("metrics").innerHTML;
  assert.ok(healthHtml.includes("Database connections health check"), "expected the health check name");
  assert.ok(!healthHtml.includes("Heap"), "no heap row without Micrometer metrics");
  assert.ok(
    win.document.getElementById("metrics-hint").innerHTML.includes("quarkus-micrometer-registry-prometheus"),
    "expected the Micrometer hint when only health is available",
  );
});

test("renderMcp tolerates an unavailable MCP server", () => {
  assert.doesNotThrow(() => win.renderMcp(null));
  assert.doesNotThrow(() => win.renderMcp({ available: false }));
});

test("the Loggers tab shares the inactive dependency story with Live JVM", () => {
  const list = () => win.document.getElementById("loggers-list").innerHTML;

  // App down on a plain Java project: a "not running" lead, no dependency fix.
  win.applyEnv({ modules: [{ name: "lib", artifactId: "lib", runnable: true }], capabilities: { maven: true } });
  win.renderLoggers({ available: false, appDown: true });
  assert.match(list(), /isn.t running/i, "expected an app-not-running lead like Live JVM");
  assert.equal(win.document.getElementById("diag-fix-lm"), null, "no fix button for a plain Java app");

  // Spring Boot without Actuator, app up but no /loggers: Add Actuator then Add BootUI.
  win.applyEnv({
    modules: [{ name: "app", artifactId: "app", runnable: true, springBoot: true, actuator: false }],
    capabilities: { springBoot: true, maven: true },
  });
  win.renderLoggers({ available: false });
  assert.ok(win.document.getElementById("diag-fix-actuator"), "Spring w/o Actuator offers Add Actuator");
  assert.ok(win.document.getElementById("diag-fix-bootui"), "and Add BootUI alongside it");

  // Quarkus without logging-manager: a single Add logging-manager fix, no Spring copy.
  win.applyEnv({
    modules: [{ name: "svc", artifactId: "svc", runnable: true, quarkus: true, loggingManager: false }],
    capabilities: { quarkus: true, maven: true },
  });
  win.renderLoggers({ available: false });
  assert.ok(win.document.getElementById("diag-fix-lm"), "Quarkus w/o logging-manager offers its fix");
  assert.ok(!/Actuator/.test(list()), "no Spring Boot copy for a Quarkus app");

  // Quarkus with logging-manager present: confirm it's set up, no fix button.
  win.applyEnv({
    modules: [{ name: "svc", artifactId: "svc", runnable: true, quarkus: true, loggingManager: true }],
    capabilities: { quarkus: true, loggingManager: true, maven: true },
  });
  win.renderLoggers({ available: false, appDown: true });
  assert.match(list(), /logging-manager is set up/i, "confirms logging-manager is set up");
  assert.equal(win.document.getElementById("diag-fix-lm"), null, "no fix once logging-manager is present");
});

test("the Spring tab offers to add Actuator only when the module lacks it", () => {
  const btn = win.document.getElementById("btn-add-actuator");
  const status = win.document.getElementById("actuator-status");

  // Spring Boot module without Actuator: the add button shows, status hidden.
  win.applyEnv({
    modules: [{ name: "app", artifactId: "app", runnable: true, springBoot: true, actuator: false, devtools: true }],
    capabilities: { springBoot: true, maven: true },
  });
  assert.equal(btn.hidden, false, "Add Actuator shown when the module lacks Actuator");
  assert.equal(status.hidden, true, "no 'on the classpath' status without Actuator");
  assert.match(btn.textContent, /with Copilot$/, "Add Actuator label ends with 'with Copilot'");
  assert.ok(btn.classList.contains("fix-copilot"), "Add Actuator uses the orange fix-copilot CTA color");
  for (const id of ["btn-add-actuator", "btn-add-devtools", "btn-add-bootui", "btn-add-bootui-spring"]) {
    const el = win.document.getElementById(id);
    assert.match(el.textContent.trim(), /with Copilot$/, `${id} label ends with 'with Copilot'`);
    assert.ok(el.classList.contains("fix-copilot"), `${id} uses the orange fix-copilot CTA color`);
  }

  // Spring Boot module with Actuator: button hidden, status shown.
  win.applyEnv({
    modules: [{ name: "app", artifactId: "app", runnable: true, springBoot: true, actuator: true, devtools: true }],
    capabilities: { springBoot: true, maven: true },
  });
  assert.equal(btn.hidden, true, "Add Actuator hidden once Actuator is present");
  assert.equal(status.hidden, false, "status confirms Actuator is on the classpath");

  // Non-Spring module: neither the button nor the status shows.
  win.applyEnv({
    modules: [{ name: "lib", artifactId: "lib", runnable: true, springBoot: false, actuator: false }],
    capabilities: {},
  });
  assert.equal(btn.hidden, true, "Add Actuator hidden for a non-Spring module");
  assert.equal(status.hidden, true, "no Actuator status for a non-Spring module");
});

test("BootUI configured suppresses the Actuator part and confirms BootUI", () => {
  const actuatorSection = win.document.getElementById("spring-actuator-section");
  const bootuiSection = win.document.getElementById("spring-bootui-section");
  const addActuator = win.document.getElementById("btn-add-actuator");
  const actuatorStatus = win.document.getElementById("actuator-status");
  const bootuiSpringStatus = win.document.getElementById("bootui-spring-status");
  const bootuiSpringHint = win.document.getElementById("bootui-spring-hint");
  const addBootuiSpring = win.document.getElementById("btn-add-bootui-spring");
  const bootuiConfigured = win.document.getElementById("bootui-configured");
  const bootuiDesc = win.document.getElementById("bootui-desc");
  const addBootui = win.document.getElementById("btn-add-bootui");

  // BootUI configured (it bundles Actuator) even with actuator:false on the module:
  // the Actuator part is hidden entirely, the BootUI part confirms it, and the scans
  // tab confirms it instead of pitching the starter.
  win.applyEnv({
    modules: [{ name: "app", artifactId: "app", runnable: true, springBoot: true, actuator: false, bootui: true }],
    capabilities: { springBoot: true, bootui: true, maven: true },
  });
  assert.equal(actuatorSection.hidden, true, "Actuator section hidden when BootUI is configured");
  assert.equal(addActuator.hidden, true, "no Add Actuator when BootUI is configured");
  assert.equal(bootuiSection.hidden, false, "BootUI section shown for a Spring project");
  assert.equal(bootuiSpringStatus.hidden, false, "Spring tab confirms BootUI is configured");
  assert.match(bootuiSpringStatus.textContent, /BootUI is configured/i);
  assert.equal(bootuiSpringHint.hidden, true, "the BootUI pitch hides once it's configured");
  assert.equal(addBootuiSpring.hidden, true, "no Add BootUI (Spring tab) once configured");
  assert.equal(addBootui.hidden, true, "no Add BootUI (scans tab) once configured");
  assert.equal(bootuiConfigured.hidden, false, "scans tab confirms BootUI is configured");
  assert.match(bootuiConfigured.textContent, /BootUI is configured/i);
  assert.equal(bootuiDesc.hidden, true, "the add-the-starter description is hidden once BootUI is configured");

  // Neither Actuator nor BootUI: both parts show, each with its Add … with Copilot CTA.
  win.applyEnv({
    modules: [{ name: "app", artifactId: "app", runnable: true, springBoot: true, actuator: false, bootui: false }],
    capabilities: { springBoot: true, maven: true },
  });
  assert.equal(actuatorSection.hidden, false, "Actuator section shown when Actuator is absent");
  assert.equal(addActuator.hidden, false, "offers Add Actuator");
  assert.equal(bootuiSection.hidden, false, "BootUI section shown below the Actuator part");
  assert.equal(addBootuiSpring.hidden, false, "offers Add BootUI below the Actuator part");
  assert.equal(bootuiSpringStatus.hidden, true, "no BootUI confirmation when BootUI is absent");

  // Actuator present but no BootUI: Actuator status shown, BootUI still offered.
  win.applyEnv({
    modules: [{ name: "app", artifactId: "app", runnable: true, springBoot: true, actuator: true, bootui: false }],
    capabilities: { springBoot: true, actuator: true, maven: true },
  });
  assert.equal(actuatorSection.hidden, false, "Actuator section shown when present without BootUI");
  assert.equal(actuatorStatus.hidden, false, "Actuator status shown when Actuator present without BootUI");
  assert.equal(addActuator.hidden, true, "no Add Actuator when Actuator is already present");
  assert.equal(addBootuiSpring.hidden, false, "still offers Add BootUI for richer metrics");
  assert.equal(bootuiConfigured.hidden, true, "scans tab does not claim BootUI configured when it isn't");
  assert.equal(bootuiDesc.hidden, false, "the add-the-starter description shows when BootUI is absent");
});

test("the Live JVM tab explains why it's inactive and offers the dependency fix", () => {
  const metrics = () => win.document.getElementById("metrics").innerHTML;

  // Spring Boot app without Actuator, not running: Add Actuator then Add BootUI.
  win.applyEnv({
    modules: [{ name: "app", artifactId: "app", runnable: true, springBoot: true, actuator: false }],
    capabilities: { springBoot: true, maven: true },
  });
  win.renderMetrics({ appUp: false });
  let actuator = win.document.getElementById("diag-fix-actuator");
  assert.ok(actuator, "a Spring app without Actuator offers Add Actuator");
  assert.match(actuator.textContent, /Add Actuator with Copilot/);
  assert.ok(actuator.classList.contains("fix-copilot"), "the metrics fix uses the orange Copilot CTA color");
  assert.ok(win.document.getElementById("diag-fix-bootui"), "and offers Add BootUI alongside it");

  // Quarkus app without Micrometer, running but no endpoint (process tier).
  win.applyEnv({
    modules: [{ name: "svc", artifactId: "svc", runnable: true, quarkus: true, quarkusMetrics: false }],
    capabilities: { quarkus: true, maven: true },
  });
  win.renderMetrics({ appUp: true, metricsTier: "process" });
  const qm = win.document.getElementById("diag-fix-qm");
  assert.ok(qm, "a Quarkus app without Micrometer offers a metrics fix");
  assert.match(qm.textContent, /Add Quarkus metrics with Copilot/);

  // Plain Java app, down: a reason, but no dependency fix to offer.
  win.applyEnv({
    modules: [{ name: "lib", artifactId: "lib", runnable: true }],
    capabilities: { maven: true },
  });
  win.renderMetrics(null);
  assert.equal(win.document.getElementById("diag-fix-actuator"), null, "no dependency fix for a plain Java app");
  assert.match(metrics(), /isn.t running/i, "explains that the app isn't running");
});

test("the Live JVM tab layers the Spring Actuator and BootUI offers", () => {
  // Actuator already on the classpath but no BootUI: confirm Actuator is set up,
  // drop the Actuator offer, and keep the BootUI offer.
  win.applyEnv({
    modules: [{ name: "app", artifactId: "app", runnable: true, springBoot: true, actuator: true, bootui: false }],
    capabilities: { springBoot: true, actuator: true, maven: true },
  });
  win.renderMetrics({ appUp: false });
  let html = win.document.getElementById("metrics").innerHTML;
  assert.match(html, /Actuator is set up/i, "tells the user Actuator is set up");
  assert.equal(win.document.getElementById("diag-fix-actuator"), null, "no Actuator offer once it's present");
  assert.ok(win.document.getElementById("diag-fix-bootui"), "still offers BootUI for richer metrics");

  // BootUI present: it covers everything, so no Actuator offer at all.
  win.applyEnv({
    modules: [{ name: "app", artifactId: "app", runnable: true, springBoot: true, actuator: true, bootui: true }],
    capabilities: { springBoot: true, actuator: true, bootui: true, maven: true },
  });
  win.renderMetrics({ appUp: false });
  html = win.document.getElementById("metrics").innerHTML;
  assert.match(html, /BootUI is set up/i, "tells the user BootUI is set up");
  assert.equal(win.document.getElementById("diag-fix-actuator"), null, "no Actuator offer when BootUI is present");
  assert.equal(win.document.getElementById("diag-fix-bootui"), null, "no BootUI offer when BootUI is present");
});

test("the Advisor scans tab shares the inactive BootUI story with Live JVM", () => {
  const scansHint = () => win.document.getElementById("scans-hint").innerHTML;

  // BootUI set up but the app is down: same two-part message as Live JVM/Loggers.
  win.applyEnv({
    modules: [{ name: "app", artifactId: "app", runnable: true, springBoot: true, actuator: true, bootui: true }],
    capabilities: { springBoot: true, actuator: true, bootui: true, maven: true },
  });
  win.renderMetrics({ appUp: false });
  assert.match(scansHint(), /isn.t running/i, "scans tab explains the app isn't running");
  assert.match(scansHint(), /BootUI is set up/i, "scans tab confirms BootUI is set up");
  assert.match(scansHint(), /run the app to use this tab/i, "scans tab tells the user to run the app");

  // Spring app without BootUI: point at the Add BootUI CTA above instead.
  win.applyEnv({
    modules: [{ name: "app", artifactId: "app", runnable: true, springBoot: true, actuator: true, bootui: false }],
    capabilities: { springBoot: true, actuator: true, maven: true },
  });
  win.renderMetrics({ appUp: false });
  assert.match(scansHint(), /need BootUI/i, "scans tab says advisor scans need BootUI when it's absent");
});

test("the Spring and Quarkus tabs explain why they're inactive", () => {
  const actuatorSection = win.document.getElementById("spring-actuator-section");
  const devtoolsSection = win.document.getElementById("spring-devtools-section");
  const quarkusEmpty = win.document.getElementById("quarkus-empty");

  // Neither a Spring nor a Quarkus project: Spring sub-sections hidden with a
  // reason, Quarkus tab shows its "not a Quarkus app" reason.
  win.applyEnv({
    modules: [{ name: "lib", artifactId: "lib", runnable: true }],
    capabilities: { maven: true },
    spring: { detected: false },
  });
  assert.equal(actuatorSection.hidden, true, "Actuator section hidden without a Spring module");
  assert.equal(devtoolsSection.hidden, true, "DevTools section hidden without a Spring module");
  assert.match(win.document.getElementById("spring-version").innerHTML, /isn.t a Spring Boot/i);
  assert.equal(quarkusEmpty.hidden, false, "Quarkus reason shown when it isn't a Quarkus app");
  assert.match(quarkusEmpty.textContent, /isn.t a Quarkus app/i);

  // A Spring Boot project: the sub-sections come back.
  win.applyEnv({
    modules: [{ name: "app", artifactId: "app", runnable: true, springBoot: true }],
    capabilities: { springBoot: true, maven: true },
    spring: { detected: true, version: "3.3.0", status: "current" },
  });
  assert.equal(actuatorSection.hidden, false, "Actuator section visible for a Spring project");
  assert.equal(devtoolsSection.hidden, false, "DevTools section visible for a Spring project");
});

test("the Settings tab is pinned to the top of the aside bar", () => {
  win.updateAsideAvailability({ jvm: true, loggers: false, bootui: false });
  const order = (name) => Number(win.document.querySelector(`.atab[data-atab="${name}"]`).style.order);
  // Available group sorts below the separator (order 50); within it Settings is
  // first (rank 0). Unavailable panels are offset by 100 so they sink to the bottom.
  assert.equal(order("settings"), 0, "Settings is pinned to the top of the bar");
  assert.ok(order("jvm") > order("settings"), "an available panel sits below Settings");
  assert.ok(order("bootui") > 100, "an unavailable panel sinks below the separator");
});

test("the aside bar keeps its canonical order in both the available and unavailable groups", () => {
  // Make every gated tab available so the whole bar sits in the available group,
  // then assert the canonical sequence the user expects:
  // Settings, Live JVM, Loggers, Spring, Quarkus, BootUI, Upgrades.
  win.updateAsideAvailability({ jvm: true, loggers: true, bootui: true, spring: true, quarkus: true });
  const order = (name) => Number(win.document.querySelector(`.atab[data-atab="${name}"]`).style.order);
  const canonical = ["settings", "jvm", "loggers", "spring", "quarkus", "bootui", "deps"];
  for (let i = 1; i < canonical.length; i++) {
    assert.ok(
      order(canonical[i]) > order(canonical[i - 1]),
      `${canonical[i]} sorts after ${canonical[i - 1]} when available`,
    );
  }

  // Grey out the runtime tabs: they drop into the unavailable group (below the
  // separator) but keep the same relative order among themselves, while the
  // always-on Settings + Upgrades stay on top.
  win.updateAsideAvailability({ jvm: false, loggers: false, bootui: false, spring: false, quarkus: false });
  assert.equal(order("settings"), 0, "Settings still leads the available group");
  assert.ok(order("deps") < 100 && order("deps") > 0, "Upgrades stays available, just after Settings");
  const unavailable = ["jvm", "loggers", "spring", "quarkus", "bootui"];
  for (const name of unavailable) assert.ok(order(name) > 100, `${name} sinks below the separator`);
  for (let i = 1; i < unavailable.length; i++) {
    assert.ok(
      order(unavailable[i]) > order(unavailable[i - 1]),
      `${unavailable[i]} keeps its canonical order after ${unavailable[i - 1]} when unavailable`,
    );
  }
});

test("renderDeps renders an outdated-library list", () => {
  assert.equal(typeof win.renderDeps, "function", "renderDeps should be a global");
  // A bad payload shows an error, not a throw.
  assert.doesNotThrow(() => win.renderDeps(null));
  assert.doesNotThrow(() => win.renderDeps({ error: "boom" }));

  // Idle snapshot: scan not yet run.
  assert.doesNotThrow(() =>
    win.renderDeps({
      ran: false,
      buildTool: "maven",
      available: true,
      updatesSupported: true,
      updates: [],
      counts: { total: 0, direct: 0, transitive: 0 },
    }),
  );
  let html = win.document.getElementById("deps-result").innerHTML;
  assert.ok(html.includes("Outdated libraries"), "expected the outdated-libraries section");
  assert.ok(html.includes("Check dependencies"), "expected the prompt to run a scan");

  // A completed scan with a direct + a transitive outdated dependency.
  assert.doesNotThrow(() =>
    win.renderDeps({
      ran: true,
      buildTool: "maven",
      available: true,
      updatesSupported: true,
      updates: [
        {
          group: "com.google.guava",
          artifact: "guava",
          current: "19.0",
          latest: "33.6.0-jre",
          scope: "compile",
          direct: true,
          via: null,
          prerelease: false,
          jump: "major",
        },
        {
          group: "org.slf4j",
          artifact: "slf4j-api",
          current: "1.7.20",
          latest: "2.1.0-alpha1",
          scope: "compile",
          direct: false,
          via: "org.example:lib",
          prerelease: true,
          jump: "major",
        },
      ],
      counts: { total: 2, direct: 1, transitive: 1 },
    }),
  );
  html = win.document.getElementById("deps-result").innerHTML;
  assert.ok(html.includes("guava"), "expected the outdated dependency in the rendered list");
  assert.ok(html.includes("data-dep-fix"), "expected a Fix-with-Copilot button per dependency");

  // Gradle: outdated scanning is now supported (same payload shape as Maven).
  assert.doesNotThrow(() =>
    win.renderDeps({
      ran: true,
      buildTool: "gradle",
      available: true,
      updatesSupported: true,
      updates: [
        {
          group: "com.google.guava",
          artifact: "guava",
          current: "19.0",
          latest: "33.6.0-jre",
          scope: "runtime",
          direct: true,
          via: null,
          prerelease: false,
          jump: "major",
        },
      ],
      counts: { total: 1, direct: 1, transitive: 0 },
    }),
  );
  html = win.document.getElementById("deps-result").innerHTML;
  assert.ok(html.includes("guava"), "expected the Gradle outdated dependency in the rendered list");
});

test("applySettingsState restores the view/preference toggles", () => {
  assert.equal(typeof win.applySettingsState, "function", "applySettingsState should be a global");
  const depsDirect = win.document.getElementById("deps-direct");
  const failuresOnly = win.document.getElementById("in-failures-only");
  const dbgSuspend = win.document.getElementById("in-dbg-suspend");

  // Saved-on state restores each checkbox.
  win.applySettingsState({ depsDirectOnly: true, testFailuresOnly: true, debugSuspend: true });
  assert.equal(depsDirect.checked, true, "deps direct-only filter should restore checked");
  assert.equal(failuresOnly.checked, true, "tests failures-only filter should restore checked");
  assert.equal(dbgSuspend.checked, true, "debug suspend option should restore checked");

  // Saved-off state clears them again.
  win.applySettingsState({ depsDirectOnly: false, testFailuresOnly: false, debugSuspend: false });
  assert.equal(depsDirect.checked, false, "deps direct-only filter should restore unchecked");
  assert.equal(failuresOnly.checked, false, "tests failures-only filter should restore unchecked");
  assert.equal(dbgSuspend.checked, false, "debug suspend option should restore unchecked");
});

test("renderTests renders a graphical report with a failure", () => {
  const report = {
    summary: { tests: 2, passed: 1, failures: 1, errors: 0, skipped: 0, timeSec: 0.2, files: 1 },
    suites: [
      {
        name: "com.example.DemoTest",
        tests: 2,
        failures: 1,
        errors: 0,
        skipped: 0,
        timeSec: 0.2,
        cases: [
          { name: "ok", classname: "com.example.DemoTest", timeSec: 0.1, status: "passed" },
          {
            name: "boom",
            classname: "com.example.DemoTest",
            timeSec: 0.1,
            status: "failed",
            message: "expected true",
            type: "java.lang.AssertionError",
            detail: "at com.example.DemoTest.boom(DemoTest.java:9)",
          },
        ],
      },
    ],
  };
  assert.doesNotThrow(() => win.renderTests(report, { runnerLabel: "Maven" }));
  const testsHtml = win.document.getElementById("tests").innerHTML;
  assert.ok(testsHtml.includes("DemoTest"), "expected the suite name in the rendered test view");
  assert.doesNotThrow(() => win.renderTests(null, { running: true }));
});

test("filterTestReport applies only-failures and search filters", () => {
  const report = {
    summary: { tests: 3, passed: 2, failures: 1, errors: 0, skipped: 0, timeSec: 0.3, files: 1 },
    suites: [
      {
        name: "com.example.AlphaTest",
        tests: 2,
        failures: 1,
        errors: 0,
        skipped: 0,
        timeSec: 0.2,
        cases: [
          { name: "ok", timeSec: 0.1, status: "passed" },
          { name: "boom", timeSec: 0.1, status: "failed" },
        ],
      },
      {
        name: "com.example.BetaTest",
        tests: 1,
        failures: 0,
        errors: 0,
        skipped: 0,
        timeSec: 0.1,
        cases: [{ name: "fine", timeSec: 0.1, status: "passed" }],
      },
    ],
  };
  assert.equal(typeof win.filterTestReport, "function", "filterTestReport should be a global");

  // No filter returns the report unchanged.
  assert.equal(win.filterTestReport(report, { failuresOnly: false, query: "" }), report);

  // Only-failures drops the all-passing suite and keeps only failing cases.
  const failed = win.filterTestReport(report, { failuresOnly: true, query: "" });
  assert.equal(failed.suites.length, 1);
  assert.equal(failed.suites[0].name, "com.example.AlphaTest");
  assert.deepEqual(
    failed.suites[0].cases.map((c) => c.name),
    ["boom"],
  );

  // A query matching a suite name keeps all of that suite's cases.
  const beta = win.filterTestReport(report, { failuresOnly: false, query: "beta" });
  assert.equal(beta.suites.length, 1);
  assert.equal(beta.suites[0].cases.length, 1);

  // A query matching a case name keeps only that case.
  const ok = win.filterTestReport(report, { failuresOnly: false, query: "ok" });
  assert.equal(ok.suites.length, 1);
  assert.deepEqual(
    ok.suites[0].cases.map((c) => c.name),
    ["ok"],
  );

  // Summary is preserved (chips keep showing run totals).
  assert.deepEqual(failed.summary, report.summary);
});

test("renderStatus tolerates an idle status snapshot", () => {
  assert.doesNotThrow(() =>
    win.renderStatus({
      build: { phase: "idle" },
      test: { phase: "idle", runnerLabel: "Maven" },
      package: { phase: "idle" },
      run: { phase: "idle" },
      debug: { phase: "idle" },
    }),
  );
});

test("a failed build shows the Fix button and replays the repaint pop", () => {
  const btnFix = win.document.getElementById("btn-fix");
  // Start from an idle build so the button is hidden, then fail it: the button
  // must become visible AND carry the one-shot pop class that forces WKWebView
  // to repaint the header (otherwise it stays invisible until a tab switch).
  win.renderStatus({
    build: { phase: "idle" },
    test: { phase: "idle" },
    package: { phase: "idle" },
    run: { phase: "idle" },
    debug: { phase: "idle" },
  });
  assert.equal(btnFix.hidden, true, "button hidden while idle");
  win.renderStatus({
    build: {
      phase: "failed",
      command: "Maven install",
      exitCode: 1,
      fix: { kind: "compile", label: "Fix build error with Copilot" },
    },
    test: { phase: "idle" },
    package: { phase: "idle" },
    run: { phase: "idle" },
    debug: { phase: "idle" },
  });
  assert.equal(btnFix.hidden, false, "button shown on a failed build");
  assert.equal(btnFix.dataset.kind, "compile");
  assert.ok(btnFix.classList.contains("cof-pop-in"), "pop class added to force a repaint");
});

test("the Spring Boot tab and its pane are present in the rail", () => {
  assert.ok(win.document.querySelector('.atab[data-atab="spring"]'), "Spring Boot rail button exists");
  assert.ok(win.document.getElementById("atab-spring"), "Spring Boot pane exists");
  // It sits between Loggers and BootUI (bootui).
  const order = [...win.document.querySelectorAll(".atab[data-atab]")].map((b) => b.dataset.atab);
  assert.ok(order.indexOf("spring") > order.indexOf("loggers"), "spring after loggers");
  assert.ok(order.indexOf("spring") < order.indexOf("bootui"), "spring before BootUI");
});

test("renderSpringAdvisor reflects version status and gates the upgrade button", () => {
  const btn = win.document.getElementById("btn-upgrade-spring");
  const box = win.document.getElementById("spring-version");

  // No Spring Boot module: empty state, no upgrade.
  assert.doesNotThrow(() => win.renderSpringAdvisor({ detected: false }));
  assert.equal(btn.hidden, true, "upgrade hidden without a Spring module");

  // EOL line: a "bad" chip and the upgrade button offered.
  win.renderSpringAdvisor({
    detected: true,
    version: "3.1.5",
    cycle: "3.1",
    status: "eol",
    ossEnd: "2024-06-30",
    latestLine: "4.1",
    latestVersion: "4.1.0",
  });
  assert.equal(btn.hidden, false, "upgrade shown for an EOL line");
  assert.ok(box.querySelector(".spring-status.bad"), "EOL renders a 'bad' status chip");
  assert.ok(btn.classList.contains("fix-copilot"), "the upgrade button uses the orange Copilot CTA color");

  // Latest line: no upgrade offered, an "ok" chip.
  win.renderSpringAdvisor({
    detected: true,
    version: "4.1.0",
    cycle: "4.1",
    status: "current",
    ossEnd: "2027-07-31",
    latestLine: "4.1",
    latestVersion: "4.1.0",
  });
  assert.equal(btn.hidden, true, "no upgrade when on the latest line");
  assert.ok(box.querySelector(".spring-status.ok"), "current renders an 'ok' status chip");
});

test("renderStatus drives the DevTools live-reload / restart buttons", () => {
  const reload = win.document.getElementById("btn-reload");
  const restart = win.document.getElementById("btn-restart-app");
  const idle = { build: {}, test: {}, package: {}, run: {}, debug: {} };

  // App down, no reload watcher: both disabled.
  win.renderStatus({ ...idle, reload: { active: false }, run: { busy: false } });
  assert.equal(reload.disabled, true, "live reload disabled when watcher inactive");
  assert.equal(restart.disabled, true, "restart disabled when app not running");

  // App running with an active reload watcher: both enabled.
  win.renderStatus({ ...idle, reload: { active: true, busy: false }, run: { busy: true } });
  assert.equal(reload.disabled, false, "live reload enabled when watcher active");
  assert.equal(restart.disabled, false, "restart enabled while the app runs");

  // Mid-recompile: live reload is busy and disabled.
  win.renderStatus({ ...idle, reload: { active: true, busy: true }, run: { busy: true } });
  assert.equal(reload.disabled, true, "live reload disabled while recompiling");
});
