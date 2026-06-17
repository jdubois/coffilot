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
});

test("renderMcp tolerates an unavailable MCP server", () => {
  assert.doesNotThrow(() => win.renderMcp(null));
  assert.doesNotThrow(() => win.renderMcp({ available: false }));
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
