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

test("renderLoggers tailors the no-endpoint hint and fix button per framework", () => {
  const list = () => win.document.getElementById("loggers-list").innerHTML;

  // Spring Boot: Actuator hint + a Fix button wired to install-actuator-loggers.
  assert.doesNotThrow(() => win.renderLoggers({ available: false, runMode: "spring" }));
  assert.ok(list().includes("Actuator"), "expected the Spring Boot Actuator hint");
  assert.ok(!list().includes("quarkus-logging-manager"), "no Quarkus copy for a Spring app");
  assert.ok(win.document.getElementById("loggers-fix"), "expected a Fix with Copilot button");

  // Quarkus: logging-manager hint + a Fix button, no Actuator copy.
  assert.doesNotThrow(() => win.renderLoggers({ available: false, runMode: "quarkus" }));
  assert.ok(list().includes("quarkus-logging-manager"), "expected the Quarkus logging-manager hint");
  assert.ok(!/Actuator/.test(list()), "no Spring Boot copy for a Quarkus app");
  assert.ok(win.document.getElementById("loggers-fix"), "expected a Fix with Copilot button");

  // Plain Java (or unknown): generic message, no fix button.
  assert.doesNotThrow(() => win.renderLoggers({ available: false, runMode: "java" }));
  assert.ok(list().includes("only"), "expected the generic 'only Spring Boot or Quarkus' message");
  assert.equal(win.document.getElementById("loggers-fix"), null, "no fix button for a non-framework app");
});

test("the Settings tab is pinned to the top of the aside bar", () => {
  win.updateAsideAvailability({ metrics: true, loggers: false, scans: false });
  const order = (name) => Number(win.document.querySelector(`.atab[data-atab="${name}"]`).style.order);
  // Available group sorts below the separator (order 50); within it Settings is
  // first (rank 0). Unavailable panels are offset by 100 so they sink to the bottom.
  assert.equal(order("settings"), 0, "Settings is pinned to the top of the bar");
  assert.ok(order("metrics") > order("settings"), "an available panel sits below Settings");
  assert.ok(order("scans") > 100, "an unavailable panel sinks below the separator");
});

test("the aside bar keeps its canonical order in both the available and unavailable groups", () => {
  // Make every gated tab available so the whole bar sits in the available group,
  // then assert the canonical sequence the user expects:
  // Settings, Live JVM, Loggers, Spring, Quarkus, BootUI, Upgrades.
  win.updateAsideAvailability({ metrics: true, loggers: true, scans: true, spring: true, quarkus: true });
  const order = (name) => Number(win.document.querySelector(`.atab[data-atab="${name}"]`).style.order);
  const canonical = ["settings", "metrics", "loggers", "spring", "quarkus", "scans", "deps"];
  for (let i = 1; i < canonical.length; i++) {
    assert.ok(
      order(canonical[i]) > order(canonical[i - 1]),
      `${canonical[i]} sorts after ${canonical[i - 1]} when available`,
    );
  }

  // Grey out the runtime tabs: they drop into the unavailable group (below the
  // separator) but keep the same relative order among themselves, while the
  // always-on Settings + Upgrades stay on top.
  win.updateAsideAvailability({ metrics: false, loggers: false, scans: false, spring: false, quarkus: false });
  assert.equal(order("settings"), 0, "Settings still leads the available group");
  assert.ok(order("deps") < 100 && order("deps") > 0, "Upgrades stays available, just after Settings");
  const unavailable = ["metrics", "loggers", "spring", "quarkus", "scans"];
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
  // It sits between Loggers and BootUI (scans).
  const order = [...win.document.querySelectorAll(".atab[data-atab]")].map((b) => b.dataset.atab);
  assert.ok(order.indexOf("spring") > order.indexOf("loggers"), "spring after loggers");
  assert.ok(order.indexOf("spring") < order.indexOf("scans"), "spring before BootUI");
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
