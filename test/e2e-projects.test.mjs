// End-to-end integration tests: actually build, test and package each sample
// project in integration-tests/ with its own wrapper (./mvnw / ./gradlew), then
// feed the real JUnit reports the build produced through Coffilot's own
// report-discovery + parsing pipeline (collectSurefireReport) and assert the
// parsed results. The command vectors come from Coffilot's own lane arg builders
// (testArgsFor / buildArgsFor / packageArgsFor), so the harness runs exactly what
// the Test / Build / Package lanes run — not a hand-maintained copy.
//
// This is the "realistic" pass — it needs a JDK 17 and network access (the
// wrappers download Maven/Gradle and dependencies), so it is SKIPPED unless
// COFFILOT_E2E=1 is set. The fast, deterministic detection + arg-builder tests
// live in integration-projects.test.mjs and always run.
//
//   COFFILOT_E2E=1 node --test test/e2e-projects.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.COFFILOT_TEST = "1";

const {
  collectSurefireReport,
  testArgsFor,
  buildArgsFor,
  packageArgsFor,
  parseDependencyTree,
  parseDependencyUpdates,
  parseGradleDependencyTree,
  parseGradleDependencyUpdates,
  gradleDepConfigFilter,
  mergeDependencyUpdates,
  mavenDepTreeArgs,
  mavenDepUpdatesArgs,
  gradleDepTreeArgs,
  gradleDepUpdatesArgs,
  gradleDependencyUpdatesInitBody,
} = await import("../extension.mjs");

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const projectsDir = path.join(repoRoot, "integration-tests");

const E2E = !!process.env.COFFILOT_E2E;
const SKIP = E2E ? false : "set COFFILOT_E2E=1 (needs JDK 17 + network) to run end-to-end builds";
const isWindows = process.platform === "win32";

// The build wrapper filename for a tool. Args come from Coffilot's lane builders.
function wrapperFor(tool) {
  if (tool === "gradle") return isWindows ? "gradlew.bat" : "gradlew";
  return isWindows ? "mvnw.cmd" : "mvnw";
}

// Run a project's wrapper with the given args, resolving { code, out }. The
// child's output is captured and only surfaced (via the assertion message) when
// the build fails, to keep passing runs quiet. A relative executable is resolved
// against the parent process cwd (not the spawn `cwd`), so join the wrapper onto
// the project dir to get an absolute path.
function runWrapper(dir, tool, args) {
  const bin = path.join(dir, wrapperFor(tool));
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

// Where each tool drops its packaged artifact (relative to the project dir).
function artifactDir(tool) {
  return tool === "gradle" ? path.join("build", "libs") : "target";
}
function hasJar(dir, tool) {
  const d = path.join(dir, artifactDir(tool));
  return existsSync(d) && readdirSync(d).some((f) => f.endsWith(".jar"));
}

// Expected real-build outcome per project. tests/files are exact for these
// controlled fixtures (see integration-tests/README.md); suites lists class-name
// suffixes that must appear in the parsed report. By default a project's tests
// all pass and the build exits 0; failing-tests overrides those to exercise the
// failure path. `cases` pins specific test-method -> status pairs.
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
  {
    // The failure path: the build exits non-zero, but Surefire still writes a
    // report that Coffilot must discover and parse with the right pass/fail/error
    // split (this is what drives the graphical test view + "Fix with Copilot").
    project: "failing-tests",
    tool: "maven",
    tests: 3,
    files: 1,
    suites: ["CalculatorTest"],
    failures: 1,
    errors: 1,
    passed: 1,
    buildShouldFail: true,
    cases: { addsTwoNumbers: "passed", failsOnPurpose: "failed", errorsOnPurpose: "error" },
  },
];

// Build/Package lane coverage: for one Maven and one Gradle project, drive the
// real Build and Package lane commands and assert each produces a jar artifact.
// Kept to the two tiny plain projects so CI stays fast.
const LIFECYCLE = [
  { project: "hello-world", tool: "maven" },
  { project: "gradle-hello-world", tool: "gradle" },
];

// Builds pull the toolchain + dependencies over the network on a cold cache, so
// allow a generous per-project budget.
const BUILD_TIMEOUT_MS = 15 * 60 * 1000;

for (const s of SCENARIOS) {
  const dir = path.join(projectsDir, s.project);
  const failures = s.failures ?? 0;
  const errors = s.errors ?? 0;
  const passed = s.passed ?? s.tests;

  test(
    `${s.project}: Test lane builds and Coffilot parses the real report`,
    { skip: SKIP, timeout: BUILD_TIMEOUT_MS },
    async () => {
      assert.ok(existsSync(dir), `missing integration project: ${dir}`);

      // Run exactly what Coffilot's Test lane runs (cold: no Gradle daemon).
      const { code, out } = await runWrapper(dir, s.tool, testArgsFor(s.tool));
      if (s.buildShouldFail) {
        assert.notEqual(code, 0, `${s.project}: expected the test build to fail, but it exited 0`);
      } else {
        assert.equal(code, 0, `${s.project} build/test failed (exit ${code}):\n${out.slice(-4000)}`);
      }

      // Drive Coffilot's actual discovery + parsing over the freshly produced
      // surefire-reports / build/test-results.
      const report = await collectSurefireReport(0, dir);

      assert.equal(report.summary.files, s.files, `${s.project}: report files`);
      assert.equal(report.summary.tests, s.tests, `${s.project}: total tests`);
      assert.equal(report.summary.failures, failures, `${s.project}: failures`);
      assert.equal(report.summary.errors, errors, `${s.project}: errors`);
      assert.equal(report.summary.passed, passed, `${s.project}: passed`);

      for (const suffix of s.suites) {
        assert.ok(
          report.suites.some((suite) => suite.name.endsWith(suffix)),
          `${s.project}: expected a parsed suite ending in ${suffix}, got ${report.suites.map((x) => x.name).join(", ")}`,
        );
      }

      // Every parsed case must carry a concrete pass/fail status (not the default).
      const byName = new Map();
      for (const suite of report.suites) {
        for (const c of suite.cases) {
          byName.set(c.name, c.status);
          assert.ok(
            ["passed", "failed", "error", "skipped"].includes(c.status),
            `bad status ${c.status} for ${c.name}`,
          );
        }
      }

      // Pin specific method -> status pairs where the scenario declares them.
      for (const [name, status] of Object.entries(s.cases ?? {})) {
        assert.equal(byName.get(name), status, `${s.project}: ${name} should be ${status}`);
      }
    },
  );
}

for (const l of LIFECYCLE) {
  const dir = path.join(projectsDir, l.project);

  test(
    `${l.project}: Build and Package lanes each produce a jar`,
    { skip: SKIP, timeout: BUILD_TIMEOUT_MS },
    async () => {
      assert.ok(existsSync(dir), `missing integration project: ${dir}`);

      // Build lane: compile + assemble without running tests.
      const build = await runWrapper(dir, l.tool, buildArgsFor(l.tool));
      assert.equal(build.code, 0, `${l.project} build lane failed (exit ${build.code}):\n${build.out.slice(-4000)}`);
      assert.ok(hasJar(dir, l.tool), `${l.project}: Build lane produced no jar in ${artifactDir(l.tool)}/`);

      // Package lane with the "Clean" toggle, so it must rebuild the artifact from
      // scratch — proving the Package lane works independently of the Build lane.
      const pkg = await runWrapper(dir, l.tool, packageArgsFor(l.tool, false, true, false));
      assert.equal(pkg.code, 0, `${l.project} package lane failed (exit ${pkg.code}):\n${pkg.out.slice(-4000)}`);
      assert.ok(hasJar(dir, l.tool), `${l.project}: Package lane produced no jar in ${artifactDir(l.tool)}/`);
    },
  );
}

// Upgrades-tab outdated-library scan, end to end: for one Maven and one Gradle
// project, run the very command vectors the scan runs (mavenDep*Args /
// gradleDep*Args + the injected init script), then feed the real output through
// Coffilot's own parsers + merge — the same pipeline runDependencyScan uses. Each
// project declares a deliberately ancient guava 19.0 (see its build file), so the
// scan must always surface guava as an outdated, direct dependency. We assert the
// shape (current/direct/jump) rather than the exact latest version, which drifts.
const DEP_SCANS = [
  { project: "hello-world", tool: "maven" },
  { project: "gradle-hello-world", tool: "gradle" },
];

// Run the active tool's outdated-library scan in `dir` and return the merged
// updates list, using exactly the exported command vectors + parsers.
async function scanOutdated(dir, tool) {
  if (tool === "maven") {
    const tree = await runWrapper(dir, "maven", mavenDepTreeArgs());
    assert.equal(tree.code, 0, `dependency:tree failed (exit ${tree.code}):\n${tree.out.slice(-4000)}`);
    const upd = await runWrapper(dir, "maven", mavenDepUpdatesArgs());
    assert.equal(upd.code, 0, `display-dependency-updates failed (exit ${upd.code}):\n${upd.out.slice(-4000)}`);
    const nodes = parseDependencyTree(tree.out);
    const updMap = parseDependencyUpdates(upd.out);
    return mergeDependencyUpdates(nodes, updMap);
  }
  // Gradle: inject the ben-manes plugin via a throwaway init script that writes a
  // JSON report into our temp dir, exactly like runGradleDependencyScan.
  const outDir = mkdtempSync(path.join(os.tmpdir(), "coffilot-deps-e2e-"));
  try {
    const initScript = path.join(outDir, "deps-init.gradle");
    writeFileSync(initScript, gradleDependencyUpdatesInitBody(outDir));
    const tree = await runWrapper(dir, "gradle", gradleDepTreeArgs());
    assert.equal(tree.code, 0, `gradle dependencies failed (exit ${tree.code}):\n${tree.out.slice(-4000)}`);
    const upd = await runWrapper(dir, "gradle", gradleDepUpdatesArgs(initScript));
    assert.equal(upd.code, 0, `dependencyUpdates failed (exit ${upd.code}):\n${upd.out.slice(-4000)}`);
    const nodes = parseGradleDependencyTree(tree.out, { configFilter: gradleDepConfigFilter });
    const updMap = new Map();
    for (const f of readdirSync(outDir)) {
      if (!f.endsWith(".json")) continue;
      for (const [k, v] of parseGradleDependencyUpdates(readFileSync(path.join(outDir, f), "utf8"))) {
        if (!updMap.has(k)) updMap.set(k, v);
      }
    }
    return mergeDependencyUpdates(nodes, updMap);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

for (const s of DEP_SCANS) {
  const dir = path.join(projectsDir, s.project);

  test(
    `${s.project}: Upgrades scan flags the outdated guava dependency`,
    { skip: SKIP, timeout: BUILD_TIMEOUT_MS },
    async () => {
      assert.ok(existsSync(dir), `missing integration project: ${dir}`);

      const updates = await scanOutdated(dir, s.tool);
      assert.ok(updates.length > 0, `${s.project}: expected at least one outdated library`);

      const guava = updates.find((u) => u.group === "com.google.guava" && u.artifact === "guava");
      assert.ok(
        guava,
        `${s.project}: expected guava in the outdated list, got ${updates.map((u) => u.artifact).join(", ")}`,
      );
      assert.equal(guava.current, "19.0", `${s.project}: guava current version`);
      assert.notEqual(guava.latest, "19.0", `${s.project}: guava should have a newer latest version`);
      assert.equal(guava.direct, true, `${s.project}: guava is a declared (direct) dependency`);
      assert.ok(["major", "minor", "patch", "other"].includes(guava.jump), `${s.project}: guava jump classified`);
    },
  );
}
