// Integration tests that drive Coffilot's real project-classification logic
// against the sample projects in integration-tests/. Each project targets a
// distinct capability tier (see integration-tests/README.md); these tests assert
// that Coffilot detects the build tool, per-module capabilities, run mode and
// metrics tier each scenario is meant to exercise — using the actual build files,
// not synthetic fixtures. They are deterministic and need no JDK/network, so they
// run as part of `npm test`. The heavier "actually build it" pass lives in
// e2e-projects.test.mjs (gated behind COFFILOT_E2E=1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Skip the side-effectful bootstrap so we can import the pure detectors. See
// extension.mjs / parsers.test.mjs.
process.env.COFFILOT_TEST = "1";

const { detectBuildTool, pomCaps, gradleCaps, readGradleBuildFile, findProjectRoot, inferRunMode } =
  await import("../extension.mjs");

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const projectsDir = path.join(repoRoot, "integration-tests");

// Compute a module's capability flags the way the runtime does: read the
// project's own build file and run the matching capability extractor. Returns the
// detected tool alongside the caps so each scenario can assert both.
function classify(dir) {
  const pom = path.join(dir, "pom.xml");
  if (existsSync(pom)) return { tool: "maven", caps: pomCaps(readFileSync(pom, "utf8"), "") };
  const gradle = readGradleBuildFile(dir);
  if (gradle != null) return { tool: "gradle", caps: gradleCaps(gradle, "") };
  throw new Error(`no Maven or Gradle build file in ${dir}`);
}

// The metrics/Run tier each scenario should resolve to, derived purely from the
// static capabilities. Mirrors Coffilot's graceful-degradation ladder (richest
// first): BootUI > Actuator > Spring (process metrics) > plain Java, with Quarkus
// as its own runnable tier.
function tierOf(c) {
  if (c.bootui) return "bootui";
  if (c.quarkus) return "quarkus";
  if (c.actuator) return "actuator";
  if (c.runnable) return "spring";
  return "java";
}

// The documented scenario matrix (kept in lockstep with integration-tests/README.md).
const SCENARIOS = [
  {
    project: "hello-world",
    tool: "maven",
    runMode: "java",
    tier: "java",
    caps: {
      runnable: false,
      springBoot: false,
      quarkus: false,
      actuator: false,
      devtools: false,
      bootui: false,
      mainClass: "com.example.helloworld.App",
    },
  },
  {
    project: "gradle-hello-world",
    tool: "gradle",
    runMode: "java",
    tier: "java",
    caps: {
      runnable: false,
      springBoot: false,
      quarkus: false,
      actuator: false,
      devtools: false,
      bootui: false,
      application: true,
      mainClass: "com.example.helloworld.App",
    },
  },
  {
    project: "spring-mvc",
    tool: "maven",
    runMode: "spring",
    tier: "spring",
    caps: { runnable: true, springBoot: true, quarkus: false, actuator: false, devtools: false, bootui: false },
  },
  {
    project: "spring-mvc-actuator-devtools",
    tool: "maven",
    runMode: "spring",
    tier: "actuator",
    caps: { runnable: true, springBoot: true, quarkus: false, actuator: true, devtools: true, bootui: false },
  },
  {
    project: "spring-mvc-bootui",
    tool: "maven",
    runMode: "spring",
    tier: "bootui",
    // BootUI lives in a `dev` Maven profile; pomCaps reads the whole pom, so the
    // starter is still detected statically (the dev Spring profile is what
    // actually wakes it at runtime).
    caps: { runnable: true, springBoot: true, quarkus: false, actuator: true, devtools: true, bootui: true },
  },
  {
    project: "quarkus-rest",
    tool: "maven",
    runMode: "quarkus",
    tier: "quarkus",
    caps: { runnable: true, springBoot: false, quarkus: true, actuator: false, devtools: false, bootui: false },
  },
];

for (const s of SCENARIOS) {
  const dir = path.join(projectsDir, s.project);

  test(`${s.project}: detects ${s.tool} as the build tool`, () => {
    assert.ok(existsSync(dir), `missing integration project: ${dir}`);
    assert.equal(detectBuildTool(dir), s.tool);
  });

  test(`${s.project}: classifies capabilities for the ${s.tier} tier`, () => {
    const { tool, caps } = classify(dir);
    assert.equal(tool, s.tool, "build tool");
    for (const [key, expected] of Object.entries(s.caps)) {
      assert.equal(caps[key], expected, `${s.project}.${key}`);
    }
  });

  test(`${s.project}: infers the ${s.runMode} run mode`, () => {
    assert.equal(inferRunMode(classify(dir).caps), s.runMode);
  });

  test(`${s.project}: resolves to the ${s.tier} capability tier`, () => {
    assert.equal(tierOf(classify(dir).caps), s.tier);
  });

  test(`${s.project}: project root is resolved from a nested source dir`, () => {
    // Coffilot walks up from the opened path to the directory that owns the build
    // marker; a file deep under src/ must still resolve to the project root.
    const nested = path.join(dir, "src", "main");
    assert.equal(findProjectRoot(nested), dir);
  });
}

test("Maven wins when both Maven and Gradle markers are present", () => {
  // Coffilot's documented "prefer Maven" rule: a directory owning both a pom.xml
  // and a build.gradle is treated as Maven.
  const tmp = mkdtempSync(path.join(os.tmpdir(), "coffilot-detect-"));
  try {
    writeFileSync(path.join(tmp, "pom.xml"), "<project/>");
    writeFileSync(path.join(tmp, "build.gradle"), "");
    assert.equal(detectBuildTool(tmp), "maven");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("a directory with no build markers detects no tool", () => {
  assert.equal(detectBuildTool(repoRoot), null);
});
