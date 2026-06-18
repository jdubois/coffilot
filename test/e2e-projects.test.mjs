// End-to-end integration tests: actually build and test each sample project in
// integration-tests/ with its own wrapper (./mvnw / ./gradlew), then feed the
// real JUnit reports the build produced through Coffilot's own report-discovery +
// parsing pipeline (collectSurefireReport) and assert the parsed results.
//
// This is the "realistic" pass — it needs a JDK 17 and network access (the
// wrappers download Maven/Gradle and dependencies), so it is SKIPPED unless
// COFFILOT_E2E=1 is set. The fast, deterministic detection tests live in
// integration-projects.test.mjs and always run.
//
//   COFFILOT_E2E=1 node --test test/e2e-projects.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.COFFILOT_TEST = "1";

const { collectSurefireReport } = await import("../extension.mjs");

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const projectsDir = path.join(repoRoot, "integration-tests");

const E2E = !!process.env.COFFILOT_E2E;
const SKIP = E2E ? false : "set COFFILOT_E2E=1 (needs JDK 17 + network) to run end-to-end builds";
const isWindows = process.platform === "win32";

// Per-tool wrapper + test goal. These mirror what Coffilot's Test lane runs
// (defaultTestArgs): `mvn test` for Maven, `cleanTest test` for Gradle (which
// forces a re-run so a fresh report is always produced). -B / --console=plain
// keep the output non-interactive in CI.
function testCommand(tool) {
  if (tool === "gradle") {
    return {
      wrapper: isWindows ? "gradlew.bat" : "gradlew",
      args: ["cleanTest", "test", "--console=plain", "--no-daemon"],
    };
  }
  return { wrapper: isWindows ? "mvnw.cmd" : "mvnw", args: ["-ntp", "-B", "test"] };
}

// Run a build wrapper in a project directory, resolving with its exit code. The
// child's output is captured and only surfaced (via the rejection / assertion
// message) when the build fails, to keep passing runs quiet.
function runBuild(dir, tool) {
  const { wrapper, args } = testCommand(tool);
  // Use the wrapper's absolute path: a relative executable is resolved against
  // the parent process cwd (not the spawn `cwd`), so join it onto the project dir.
  const bin = path.join(dir, wrapper);
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: dir, env: process.env });
    let out = "";
    const capture = (chunk) => {
      out += chunk;
      if (out.length > 200000) out = out.slice(-200000); // bound memory on chatty builds
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out }));
  });
}

// Expected real-build outcome per project. tests/files are exact for these
// controlled fixtures (see integration-tests/README.md); suites lists class-name
// suffixes that must appear in the parsed report.
const SCENARIOS = [
  { project: "hello-world", tool: "maven", tests: 1, files: 1, suites: ["AppTest"] },
  { project: "gradle-hello-world", tool: "gradle", tests: 1, files: 1, suites: ["AppTest"] },
  {
    project: "spring-mvc",
    tool: "maven",
    tests: 2,
    files: 2,
    suites: ["HelloControllerTest", "SpringMvcApplicationTests"],
  },
  {
    project: "spring-mvc-actuator-devtools",
    tool: "maven",
    tests: 2,
    files: 2,
    suites: ["HelloControllerTest", "SpringMvcActuatorDevtoolsApplicationTests"],
  },
  {
    project: "spring-mvc-bootui",
    tool: "maven",
    tests: 2,
    files: 2,
    suites: ["HelloControllerTest", "SpringMvcBootuiApplicationTests"],
  },
  {
    project: "quarkus-rest",
    tool: "maven",
    tests: 2,
    files: 2,
    suites: ["GreetingResourceTest", "GreetingResourceUnitTest"],
  },
];

// Builds pull the toolchain + dependencies over the network on a cold cache, so
// allow a generous per-project budget.
const BUILD_TIMEOUT_MS = 15 * 60 * 1000;

for (const s of SCENARIOS) {
  const dir = path.join(projectsDir, s.project);

  test(
    `${s.project}: builds, tests and Coffilot parses the real report`,
    { skip: SKIP, timeout: BUILD_TIMEOUT_MS },
    async () => {
      assert.ok(existsSync(dir), `missing integration project: ${dir}`);

      const { code, out } = await runBuild(dir, s.tool);
      assert.equal(code, 0, `${s.project} build/test failed (exit ${code}):\n${out.slice(-4000)}`);

      // Drive Coffilot's actual discovery + parsing over the freshly produced
      // surefire-reports / build/test-results.
      const report = await collectSurefireReport(0, dir);

      assert.equal(report.summary.files, s.files, `${s.project}: report files`);
      assert.equal(report.summary.tests, s.tests, `${s.project}: total tests`);
      assert.equal(report.summary.failures, 0, `${s.project}: failures`);
      assert.equal(report.summary.errors, 0, `${s.project}: errors`);
      assert.equal(report.summary.passed, s.tests, `${s.project}: passed`);

      for (const suffix of s.suites) {
        assert.ok(
          report.suites.some((suite) => suite.name.endsWith(suffix)),
          `${s.project}: expected a parsed suite ending in ${suffix}, got ${report.suites.map((x) => x.name).join(", ")}`,
        );
      }

      // Every parsed case must carry a concrete pass/fail status (not the default).
      for (const suite of report.suites) {
        for (const c of suite.cases) {
          assert.ok(
            ["passed", "failed", "error", "skipped"].includes(c.status),
            `bad status ${c.status} for ${c.name}`,
          );
        }
      }
    },
  );
}
