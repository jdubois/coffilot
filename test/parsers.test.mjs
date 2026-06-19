// Unit tests for the pure parsers / normalizers exported from extension.mjs.
// COFFILOT_TEST=1 (set in the test runner) makes the module skip its
// side-effectful bootstrap (joining a session, starting the loopback server) so
// these pure functions can be imported in isolation. See extension.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.COFFILOT_TEST = "1";

const {
  parseSurefireSuiteXml,
  parseClassRefs,
  affectedTestsFromIndex,
  internalToDotted,
  parsePrometheus,
  promSum,
  promSingle,
  promFirstLabel,
  quarkusMetrics,
  normalizeQuarkusLoggers,
  maskSecrets,
  buildHistoryEntry,
  clampHistory,
  clampMetricsPollMs,
  parseJfrStacks,
  pickAppPidFromJvmList,
  quarkusDevConsoleFailed,
  jdkSupportsNativeAccess,
  springBootVersionFromPom,
  springBootVersionFromGradle,
  parseDependencyTree,
  parseDependencyUpdates,
  mergeDependencyUpdates,
  parseGradleDependencyTree,
  parseGradleDependencyUpdates,
  gradleDepConfigFilter,
  classifyVersionJump,
  isPrerelease,
} = await import("../extension.mjs");

// ---------------------------------------------------------------------------
// JUnit / Surefire XML report parser
// ---------------------------------------------------------------------------

test("parseSurefireSuiteXml parses counts and a passing case", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="com.example.DemoTest" tests="2" failures="0" errors="0" skipped="0" time="0.123">
  <testcase name="contextLoads" classname="com.example.DemoTest" time="0.05"/>
  <testcase name="works" classname="com.example.DemoTest" time="0.07"/>
</testsuite>`;
  const suite = parseSurefireSuiteXml(xml, "fallback");
  assert.equal(suite.name, "com.example.DemoTest");
  assert.equal(suite.tests, 2);
  assert.equal(suite.failures, 0);
  assert.equal(suite.timeSec, 0.123);
  assert.equal(suite.cases.length, 2);
  assert.equal(suite.cases[0].status, "passed");
  assert.equal(suite.cases[0].name, "contextLoads");
});

test("parseSurefireSuiteXml captures failure, error and skipped cases", () => {
  const xml = `<testsuite name="S" tests="3" failures="1" errors="1" skipped="1" time="0.5">
  <testcase name="boom" classname="S" time="0.1">
    <failure message="expected true" type="java.lang.AssertionError">stack line 1
stack line 2</failure>
  </testcase>
  <testcase name="kaput" classname="S" time="0.2">
    <error message="NPE" type="java.lang.NullPointerException">at S.kaput(S.java:9)</error>
  </testcase>
  <testcase name="ignored" classname="S" time="0">
    <skipped/>
  </testcase>
</testsuite>`;
  const suite = parseSurefireSuiteXml(xml);
  assert.equal(suite.failures, 1);
  assert.equal(suite.errors, 1);
  assert.equal(suite.skipped, 1);
  const byName = Object.fromEntries(suite.cases.map((c) => [c.name, c]));
  assert.equal(byName.boom.status, "failed");
  assert.equal(byName.boom.message, "expected true");
  assert.equal(byName.boom.type, "java.lang.AssertionError");
  assert.match(byName.boom.detail, /stack line 1\nstack line 2/);
  assert.equal(byName.kaput.status, "error");
  assert.equal(byName.ignored.status, "skipped");
});

test("parseSurefireSuiteXml falls back to the provided name when absent", () => {
  const suite = parseSurefireSuiteXml(`<testsuite tests="0"></testsuite>`, "FromFileName");
  assert.equal(suite.name, "FromFileName");
  assert.equal(suite.cases.length, 0);
});

// ---------------------------------------------------------------------------
// .class constant-pool reference parser
// ---------------------------------------------------------------------------

// Build a minimal but valid .class buffer: magic + version + a constant pool of
// one CONSTANT_Utf8 (the internal class name) and one CONSTANT_Class pointing at
// it. parseClassRefs only walks the constant pool, so the body can be empty.
function makeClassBuffer(internalName) {
  const nameBytes = Buffer.from(internalName, "utf8");
  const parts = [];
  parts.push(Buffer.from([0xca, 0xfe, 0xba, 0xbe])); // magic
  parts.push(Buffer.from([0x00, 0x00])); // minor
  parts.push(Buffer.from([0x00, 0x34])); // major (Java 8)
  parts.push(Buffer.from([0x00, 0x03])); // constant_pool_count = 3 (entries 1..2)
  // #1 CONSTANT_Utf8
  const utf8 = Buffer.alloc(3);
  utf8[0] = 1;
  utf8.writeUInt16BE(nameBytes.length, 1);
  parts.push(utf8, nameBytes);
  // #2 CONSTANT_Class -> name_index = 1
  const cls = Buffer.alloc(3);
  cls[0] = 7;
  cls.writeUInt16BE(1, 1);
  parts.push(cls);
  return Buffer.concat(parts);
}

test("parseClassRefs extracts dotted class references from the constant pool", () => {
  const buf = makeClassBuffer("com/example/Foo");
  const refs = parseClassRefs(buf);
  assert.ok(refs instanceof Set);
  assert.ok(refs.has("com.example.Foo"), `expected com.example.Foo, got ${[...refs]}`);
});

test("parseClassRefs recovers descriptor types (L...;) from Utf8 entries", () => {
  const buf = makeClassBuffer("Lcom/example/Bar;");
  const refs = parseClassRefs(buf);
  assert.ok(refs.has("com.example.Bar"), `expected com.example.Bar, got ${[...refs]}`);
});

test("parseClassRefs returns null for a non-class buffer", () => {
  assert.equal(parseClassRefs(Buffer.from("not a class file")), null);
  assert.equal(parseClassRefs(Buffer.from([0x00, 0x01])), null);
});

test("internalToDotted handles plain, descriptor and array forms", () => {
  assert.equal(internalToDotted("com/example/Foo"), "com.example.Foo");
  assert.equal(internalToDotted("Lcom/example/Foo;"), "com.example.Foo");
  assert.equal(internalToDotted("[Lcom/example/Foo;"), "com.example.Foo");
  assert.equal(internalToDotted("I"), null); // primitive
});

// ---------------------------------------------------------------------------
// Affected-test selection over the class dependency graph
// ---------------------------------------------------------------------------

function entry(name, kind, refs, extra = {}) {
  return [name, { name, kind, module: "", refs: new Set(refs), isTest: kind === "test", dynamic: false, ...extra }];
}

test("affectedTestsFromIndex selects transitive dependents that are tests", () => {
  // FooTest -> Foo -> Bar.  A change to Bar should select FooTest.
  const index = new Map([
    entry("com.example.Bar", "main", []),
    entry("com.example.Foo", "main", ["com.example.Bar"]),
    entry("com.example.FooTest", "test", ["com.example.Foo"]),
    entry("com.example.UnrelatedTest", "test", ["com.example.Other"]),
  ]);
  const affected = affectedTestsFromIndex(index, ["com.example.Bar"]);
  const names = affected.map((t) => t.fqcn).sort();
  assert.deepEqual(names, ["com.example.FooTest"]);
});

test("affectedTestsFromIndex always includes dynamic tests", () => {
  const index = new Map([
    entry("com.example.Foo", "main", []),
    entry("com.example.ArchTest", "test", [], { dynamic: true }),
  ]);
  const affected = affectedTestsFromIndex(index, ["com.example.Nothing"]);
  assert.ok(affected.some((t) => t.fqcn === "com.example.ArchTest"));
});

test("affectedTestsFromIndex collapses inner classes to the top-level test", () => {
  const index = new Map([
    entry("com.example.Svc", "main", []),
    entry("com.example.SvcTest", "test", ["com.example.Svc"]),
    entry("com.example.SvcTest$Nested", "test", ["com.example.Svc"]),
  ]);
  const affected = affectedTestsFromIndex(index, ["com.example.Svc"]);
  const names = affected.map((t) => t.fqcn);
  assert.deepEqual([...new Set(names)].sort(), ["com.example.SvcTest"]);
});

// ---------------------------------------------------------------------------
// Prometheus scrape parsing + metrics normalization
// ---------------------------------------------------------------------------

const PROM = `# HELP jvm_memory_used_bytes used
# TYPE jvm_memory_used_bytes gauge
jvm_memory_used_bytes{area="heap",id="Eden"} 1000
jvm_memory_used_bytes{area="heap",id="Old"} 2000
jvm_memory_used_bytes{area="nonheap",id="Metaspace"} 500
jvm_memory_max_bytes{area="heap",id="Eden"} 4000
jvm_memory_max_bytes{area="heap",id="Old"} 6000
jvm_memory_max_bytes{area="nonheap",id="Metaspace"} -1
jvm_threads_live_threads 12
jvm_threads_daemon_threads 8
process_uptime_seconds 3.5
jvm_info{version="21.0.1",vendor="Eclipse"} 1
`;

test("parsePrometheus groups samples by metric name with labels", () => {
  const s = parsePrometheus(PROM);
  assert.equal(s.get("jvm_memory_used_bytes").length, 3);
  assert.equal(s.get("jvm_threads_live_threads")[0].value, 12);
  assert.equal(s.get("jvm_memory_used_bytes")[0].labels.area, "heap");
});

test("promSum filters by area and skips negative (unbounded) values", () => {
  const s = parsePrometheus(PROM);
  assert.equal(promSum(s, "jvm_memory_used_bytes", "heap"), 3000);
  assert.equal(promSum(s, "jvm_memory_used_bytes", "nonheap"), 500);
  assert.equal(promSum(s, "jvm_memory_max_bytes", "heap"), 10000);
  // -1 is unbounded and must be ignored.
  assert.equal(promSum(s, "jvm_memory_max_bytes", "nonheap"), null);
  assert.equal(promSum(s, "does_not_exist", "heap"), null);
});

test("promSingle and promFirstLabel read scalar values and labels", () => {
  const s = parsePrometheus(PROM);
  assert.equal(promSingle(s, "jvm_threads_live_threads"), 12);
  assert.equal(promSingle(s, "missing"), null);
  assert.equal(promFirstLabel(s, "jvm_info", "version"), "21.0.1");
  assert.equal(promFirstLabel(s, "jvm_info", "nope"), null);
});

test("quarkusMetrics normalizes a scrape + health into the shared shape", () => {
  const out = quarkusMetrics(PROM, { status: "UP" });
  assert.equal(out.metricsTier, "quarkus");
  assert.equal(out.appUp, true);
  assert.equal(out.health.status, "UP");
  assert.equal(out.overview.javaVersion, "21.0.1");
  assert.equal(out.memory.heap.usedBytes, 3000);
  assert.equal(out.memory.heap.maxBytes, 10000);
  assert.equal(out.memory.heap.usedPercent, 30);
  assert.equal(out.memory.nonHeap.usedBytes, 500);
  assert.equal(out.threads.totalThreads, 12);
  assert.equal(out.threads.daemonThreads, 8);
  assert.equal(out.overview.startupTimeMillis, 3500);
});

test("quarkusMetrics tolerates a missing scrape", () => {
  const out = quarkusMetrics(null, { status: "DOWN" });
  assert.equal(out.metricsTier, "quarkus");
  assert.equal(out.health.status, "DOWN");
  assert.equal(out.memory, null);
});

test("quarkusMetrics reads the Java version from the jvm_info_total gauge", () => {
  // Quarkus 3.x (Micrometer + Prometheus 1.x client) renames the jvm_info gauge
  // to jvm_info_total; the version must still surface on the Quarkus tier.
  const scrape = 'jvm_info_total{runtime="OpenJDK Runtime Environment",vendor="Homebrew",version="26.0.1"} 1.0\n';
  const out = quarkusMetrics(scrape, { status: "UP" });
  assert.equal(out.overview.javaVersion, "26.0.1");
});

test("quarkusMetrics surfaces the SmallRye health checks breakdown", () => {
  // A Quarkus app with only smallrye-health (no Micrometer) still reports the
  // per-component checks, so the panel shows more than a bare overall status.
  const health = {
    status: "DOWN",
    checks: [
      { name: "Database connections health check", status: "UP", data: {} },
      { name: "Reactive Messaging - liveness check", status: "DOWN" },
    ],
  };
  const out = quarkusMetrics(null, health);
  assert.equal(out.health.status, "DOWN");
  assert.deepEqual(out.health.checks, [
    { name: "Database connections health check", status: "UP" },
    { name: "Reactive Messaging - liveness check", status: "DOWN" },
  ]);
});

test("quarkusMetrics defaults the health checks to an empty list", () => {
  const out = quarkusMetrics(null, { status: "UP" });
  assert.deepEqual(out.health, { status: "UP", checks: [] });
});

test("normalizeQuarkusLoggers maps the listing to the shared shape (ROOT first)", () => {
  const out = normalizeQuarkusLoggers(
    [
      { name: "org.acme.Svc", configuredLevel: "DEBUG", effectiveLevel: "DEBUG" },
      { name: "", configuredLevel: "INFO", effectiveLevel: "INFO" },
      { name: "io.quarkus", configuredLevel: null, effectiveLevel: "INFO" },
    ],
    ["INFO", "DEBUG"],
  );
  assert.equal(out.available, true);
  assert.equal(out.source, "quarkus");
  assert.deepEqual(
    out.loggers.map((l) => l.name),
    ["ROOT", "io.quarkus", "org.acme.Svc"],
  );
  // The empty JBoss root name becomes ROOT and keeps its level.
  assert.equal(out.loggers[0].configuredLevel, "INFO");
  // A null configuredLevel normalizes to null (the UI's "inherit" state).
  assert.equal(out.loggers[1].configuredLevel, null);
  assert.deepEqual(out.levels, ["INFO", "DEBUG"]);
});

test("normalizeQuarkusLoggers falls back to JBoss levels and rejects non-arrays", () => {
  const out = normalizeQuarkusLoggers([{ name: "ROOT", configuredLevel: "INFO", effectiveLevel: "INFO" }], null);
  assert.ok(out.levels.includes("TRACE") && out.levels.includes("FINEST"));
  assert.equal(normalizeQuarkusLoggers(null, ["INFO"]), null);
});

// ---------------------------------------------------------------------------
// Secret masking
// ---------------------------------------------------------------------------

const R = "***REDACTED***";
// Synthetic tokens built by concatenation so the test file itself carries no
// scannable secret, while still exercising maskSecrets at runtime.
const ghToken = "ghp_" + "0123456789abcdefghijABCDEFGHIJ01";
const awsKey = "AKIA" + "IOSFODNN7EXAMPLE";
const jwt = "eyJ" + "abcdefgh" + "." + "payload01ABCDEFG" + "." + "signature1ABCDEFG";

test("maskSecrets redacts credential assignments but keeps the key", () => {
  assert.equal(maskSecrets("DB_PASSWORD=hunter2longvalue"), `DB_PASSWORD=${R}`);
  assert.equal(maskSecrets("spring.datasource.password: s3cr3tValue"), `spring.datasource.password: ${R}`);
  assert.equal(maskSecrets('api-key="abcdef123456"'), `api-key="${R}"`);
  assert.equal(maskSecrets("ACCESS_TOKEN = 'tok_abcdef12345'"), `ACCESS_TOKEN = '${R}'`);
});

test("maskSecrets redacts provider token shapes", () => {
  assert.equal(maskSecrets("token " + ghToken), `token ${R}`);
  assert.equal(maskSecrets(awsKey), R);
  assert.ok(!maskSecrets(awsKey).includes(awsKey));
  assert.ok(!maskSecrets(jwt).includes(jwt));
});

test("maskSecrets redacts Authorization tokens but keeps the scheme", () => {
  // Build the scheme word from fragments so the surrounding tooling does not
  // treat the literal as a real credential.
  const scheme = "Bea" + "rer";
  assert.equal(maskSecrets("Authorization: " + scheme + " abc123DEF456ghi789JKL"), `Authorization: ${scheme} ${R}`);
  assert.equal(maskSecrets("Authorization: Basic dXNlcjpwYXNzd29yZA=="), `Authorization: Basic ${R}`);
});

test("maskSecrets redacts credentials embedded in a URL", () => {
  const url = "jdbc:postgresql://" + "appuser:secretpw" + "@db.example.com:5432/app";
  assert.equal(maskSecrets(url), `jdbc:postgresql://${R}@db.example.com:5432/app`);
});

test("maskSecrets leaves ordinary build output untouched", () => {
  const line = "[INFO] BUILD SUCCESS in 4.405 s -- 12 tests, 0 failures";
  assert.equal(maskSecrets(line), line);
  assert.equal(maskSecrets("Compiling 7 source files to target/classes"), "Compiling 7 source files to target/classes");
});

test("maskSecrets is null-safe", () => {
  assert.equal(maskSecrets(null), null);
  assert.equal(maskSecrets(undefined), undefined);
});

// ---------------------------------------------------------------------------
// Lane history (de)serialization
// ---------------------------------------------------------------------------

test("buildHistoryEntry captures a lane's terminal state compactly", () => {
  const lane = { op: "test", phase: "failed", command: "./mvnw -B test", exitCode: 1 };
  const entry = buildHistoryEntry(lane, {
    testSummary: { tests: 3, failures: 1, errors: 0, skipped: 0 },
    tailLines: ["a", "b", "c"],
    now: 1700000000000,
  });
  assert.equal(entry.op, "test");
  assert.equal(entry.phase, "failed");
  assert.equal(entry.command, "./mvnw -B test");
  assert.equal(entry.exitCode, 1);
  assert.equal(entry.ts, 1700000000000);
  assert.deepEqual(entry.testSummary, { tests: 3, failures: 1, errors: 0, skipped: 0 });
  assert.deepEqual(entry.tail, ["a", "b", "c"]);
});

test("buildHistoryEntry defaults and bounds the console tail", () => {
  const lane = { op: "build", phase: "idle", command: "", exitCode: null };
  const entry = buildHistoryEntry(lane);
  assert.equal(entry.command, "");
  assert.equal(entry.exitCode, null);
  assert.equal(entry.testSummary, null);
  assert.deepEqual(entry.tail, []);
  const long = Array.from({ length: 100 }, (_, i) => `line ${i}`);
  const bounded = buildHistoryEntry(lane, { tailLines: long });
  assert.equal(bounded.tail.length, 40);
  assert.equal(bounded.tail[bounded.tail.length - 1], "line 99");
});

test("clampHistory prepends newest and bounds the list", () => {
  let list = [];
  for (let i = 0; i < 8; i++) list = clampHistory(list, { ts: i }, 5);
  assert.equal(list.length, 5);
  assert.equal(list[0].ts, 7); // newest first
  assert.equal(list[4].ts, 3);
});

test("a lane history entry survives a JSON round-trip unchanged", () => {
  const lane = { op: "run", phase: "stopped", command: "./gradlew bootRun", exitCode: 0 };
  const entry = buildHistoryEntry(lane, { tailLines: ["started", "stopped"], now: 42 });
  const restored = JSON.parse(JSON.stringify({ run: clampHistory([], entry) }));
  assert.deepEqual(restored.run[0], entry);
});

// ---------------------------------------------------------------------------
// Metrics poll interval clamping
// ---------------------------------------------------------------------------

test("clampMetricsPollMs bounds the interval and defaults non-finite input", () => {
  assert.equal(clampMetricsPollMs(2500), 2500);
  assert.equal(clampMetricsPollMs(100), 500); // below min
  assert.equal(clampMetricsPollMs(99999), 30000); // above max
  assert.equal(clampMetricsPollMs(1234.6), 1235); // rounded
  assert.equal(clampMetricsPollMs("abc"), 2500); // non-finite -> default
  assert.equal(clampMetricsPollMs(undefined), 2500);
});

// ---------------------------------------------------------------------------
// JFR profiling fallback: stack parsing + app-PID selection
// ---------------------------------------------------------------------------

test("parseJfrStacks folds execution samples into collapsed root-first stacks", () => {
  const text = [
    "jdk.ExecutionSample {",
    '  sampledThread = "main"',
    '  state = "STATE_RUNNABLE"',
    "  stackTrace = [",
    "    com.example.Service.compute(int) line: 42",
    "    com.example.Service.handle() line: 20",
    "    com.example.App.main(java.lang.String[]) line: 10",
    "  ]",
    "}",
    "jdk.ExecutionSample {",
    "  stackTrace = [",
    "    com.example.Service.compute(int) line: 42",
    "    com.example.Service.handle() line: 20",
    "    com.example.App.main(java.lang.String[]) line: 10",
    "  ]",
    "}",
    "jdk.ExecutionSample {",
    "  stackTrace = [",
    "    java.lang.Thread.run() [optimized]",
    "  ]",
    "}",
  ].join("\n");
  const collapsed = parseJfrStacks(text);
  const lines = collapsed.trim().split("\n").sort();
  assert.deepEqual(lines, [
    "com.example.App.main;com.example.Service.handle;com.example.Service.compute 2",
    "java.lang.Thread.run 1",
  ]);
});

test("parseJfrStacks tolerates empty / non-sample input", () => {
  assert.equal(parseJfrStacks("").trim(), "");
  assert.equal(parseJfrStacks(null).trim(), "");
  assert.equal(parseJfrStacks("no events here\njust text").trim(), "");
});

test("pickAppPidFromJvmList skips wrappers, the tool, and self", () => {
  const listing = [
    "12345 org.codehaus.plexus.classworlds.launcher.Launcher clean test",
    "12346 com.example.App",
    "999 jdk.jcmd/sun.tools.jcmd.JCmd -l",
  ].join("\n");
  assert.equal(pickAppPidFromJvmList(listing, 4242), 12346);

  const gradle = ["555 org.gradle.wrapper.GradleWrapperMain bootRun", "556 com.example.QuarkusApp"].join("\n");
  assert.equal(pickAppPidFromJvmList(gradle, 4242), 556);

  // Only the current process and a wrapper -> nothing to attach to.
  assert.equal(pickAppPidFromJvmList("4242 com.example.App\n777 org.gradle.launcher.daemon.bootstrap.X", 4242), null);

  // Entries with an unknown main class are skipped.
  assert.equal(pickAppPidFromJvmList("100 Unknown\n101 com.example.App", 1), 101);
});

// ---------------------------------------------------------------------------
// Quarkus dev-mode build/augmentation failure detector
// ---------------------------------------------------------------------------

test("quarkusDevConsoleFailed flags a failed augmentation that kept running", () => {
  const lines = [
    "Listening for transport dt_socket at address: 5005",
    "INFO  [io.quarkus] Quarkus building...",
    "ERROR [io.qua.dev.DevModeMain] Failed to start quarkus",
    "Caused by: io.quarkus.builder.BuildException: Build failure",
    "Attempting to start hot replacement endpoint to recover from previous Quarkus startup failure",
  ];
  assert.equal(quarkusDevConsoleFailed(lines), true);
});

test("quarkusDevConsoleFailed clears once a later start/reload succeeds", () => {
  const lines = [
    "ERROR [io.qua.dev.DevModeMain] Failed to start quarkus",
    "recover from previous Quarkus startup failure",
    "INFO  [io.quarkus] Quarkus 1.3.2.Final started in 1.234s. Listening on: http://0.0.0.0:8080",
    "INFO  [io.quarkus] Installed features: [cdi, hibernate-orm]",
  ];
  assert.equal(quarkusDevConsoleFailed(lines), false);
});

test("quarkusDevConsoleFailed is false for a clean dev start", () => {
  const lines = [
    "INFO  [io.quarkus] Quarkus started in 0.9s. Listening on: http://0.0.0.0:8080",
    "INFO  [io.quarkus] Profile dev activated. Live Coding activated.",
  ];
  assert.equal(quarkusDevConsoleFailed(lines), false);
});

test("quarkusDevConsoleFailed re-flags a failed live reload after a good start", () => {
  const lines = [
    "INFO  [io.quarkus] Quarkus started in 0.9s. Listening on: http://0.0.0.0:8080",
    "INFO  [io.quarkus] Profile dev activated. Live Coding activated.",
    "ERROR Re-compilation failed",
    "Failed to start quarkus",
  ];
  assert.equal(quarkusDevConsoleFailed(lines), true);
});

// ---------------------------------------------------------------------------
// --enable-native-access JDK gating (jdkSupportsNativeAccess)
// ---------------------------------------------------------------------------

test("jdkSupportsNativeAccess: JDK 16+ accepts --enable-native-access", () => {
  assert.equal(jdkSupportsNativeAccess(16), true);
  assert.equal(jdkSupportsNativeAccess(17), true);
  assert.equal(jdkSupportsNativeAccess(21), true);
  assert.equal(jdkSupportsNativeAccess(26), true);
});

test("jdkSupportsNativeAccess: older JDKs that reject the flag are excluded", () => {
  assert.equal(jdkSupportsNativeAccess(8), false);
  assert.equal(jdkSupportsNativeAccess(11), false);
  assert.equal(jdkSupportsNativeAccess(15), false);
});

test("jdkSupportsNativeAccess: unknown/invalid majors omit the flag", () => {
  assert.equal(jdkSupportsNativeAccess(null), false);
  assert.equal(jdkSupportsNativeAccess(undefined), false);
  assert.equal(jdkSupportsNativeAccess(NaN), false);
});

// ---------------------------------------------------------------------------
// Spring Boot version detection (Spring Boot tab EOL/upgrade advisor)
// ---------------------------------------------------------------------------

test("springBootVersionFromPom reads the spring-boot-starter-parent version", () => {
  const xml = `<project>
    <parent>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-parent</artifactId>
      <version>3.4.13</version>
    </parent>
  </project>`;
  assert.equal(springBootVersionFromPom(xml), "3.4.13");
});

test("springBootVersionFromPom falls back to the spring-boot.version property and BOM", () => {
  const prop = `<project><properties><spring-boot.version>3.2.0</spring-boot.version></properties></project>`;
  assert.equal(springBootVersionFromPom(prop), "3.2.0");
  const bom = `<dependencyManagement><dependencies><dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-dependencies</artifactId>
    <version>3.5.1</version>
  </dependency></dependencies></dependencyManagement>`;
  assert.equal(springBootVersionFromPom(bom), "3.5.1");
});

test("springBootVersionFromPom ignores an unresolved ${...} placeholder version", () => {
  const xml = `<project><parent>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>\${spring.boot.version}</version>
  </parent></project>`;
  assert.equal(springBootVersionFromPom(xml), null);
});

test("springBootVersionFromGradle reads the plugin version (Groovy + Kotlin DSL)", () => {
  const groovy = `plugins { id 'org.springframework.boot' version '3.3.5' }`;
  assert.equal(springBootVersionFromGradle(groovy), "3.3.5");
  const kotlin = `plugins { id("org.springframework.boot") version "3.4.0" }`;
  assert.equal(springBootVersionFromGradle(kotlin), "3.4.0");
});

test("springBootVersionFromGradle reads a buildscript classpath and skips variables", () => {
  const classpath = `buildscript { dependencies { classpath "org.springframework.boot:spring-boot-gradle-plugin:2.7.18" } }`;
  assert.equal(springBootVersionFromGradle(classpath), "2.7.18");
  const variable = `plugins { id 'org.springframework.boot' version "$springBootVersion" }`;
  assert.equal(springBootVersionFromGradle(variable), null);
});

// ---------------------------------------------------------------------------
// Dependencies — outdated-library parsers
// ---------------------------------------------------------------------------

test("parseDependencyTree classifies direct vs transitive by tree depth", () => {
  const out = [
    "[INFO] com.example:demo:jar:1.0.0",
    "[INFO] +- org.springframework.boot:spring-boot-starter-webmvc:jar:4.0.0:compile",
    "[INFO] |  +- org.springframework:spring-web:jar:7.0.0:compile",
    "[INFO] |  \\- com.fasterxml.jackson.core:jackson-databind:jar:2.18.0:compile",
    "[INFO] \\- com.google.guava:guava:jar:19.0:compile",
  ].join("\n");
  const nodes = parseDependencyTree(out);
  const byKey = Object.fromEntries(nodes.map((n) => [n.key, n]));
  assert.equal(byKey["org.springframework.boot:spring-boot-starter-webmvc"].direct, true);
  assert.equal(byKey["com.google.guava:guava"].direct, true);
  assert.equal(byKey["org.springframework:spring-web"].direct, false);
  assert.equal(byKey["org.springframework:spring-web"].via, "org.springframework.boot:spring-boot-starter-webmvc");
  assert.equal(byKey["com.fasterxml.jackson.core:jackson-databind"].version, "2.18.0");
});

test("parseDependencyTree handles a 6-part coordinate with a classifier", () => {
  const out = "[INFO] +- org.example:native-lib:jar:linux-x86_64:1.2.3:runtime";
  const nodes = parseDependencyTree(out);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].version, "1.2.3");
  assert.equal(nodes[0].scope, "runtime");
  assert.equal(nodes[0].direct, true);
});

test("parseDependencyTree keeps the shallowest occurrence of a duplicate", () => {
  const out = [
    "[INFO] +- com.google.guava:guava:jar:19.0:compile",
    "[INFO] \\- org.example:wrapper:jar:1.0:compile",
    "[INFO]    \\- com.google.guava:guava:jar:19.0:compile",
  ].join("\n");
  const nodes = parseDependencyTree(out);
  const guava = nodes.filter((n) => n.key === "com.google.guava:guava");
  assert.equal(guava.length, 1);
  assert.equal(guava[0].direct, true);
});

test("parseDependencyUpdates extracts current -> latest per coordinate", () => {
  const out = [
    "[INFO] The following dependencies in Dependencies have newer versions:",
    "[INFO]   com.google.guava:guava ..................... 19.0 -> 33.6.0-jre",
    "[INFO]   org.slf4j:slf4j-api ........................ 1.7.20 -> 2.1.0-alpha1",
    "[INFO] ",
  ].join("\n");
  const map = parseDependencyUpdates(out);
  assert.equal(map.get("com.google.guava:guava").latest, "33.6.0-jre");
  assert.equal(map.get("org.slf4j:slf4j-api").current, "1.7.20");
  assert.equal(map.size, 2);
});

test("mergeDependencyUpdates joins tree + updates, sorts direct-first by jump", () => {
  const nodes = parseDependencyTree(
    [
      "[INFO] +- com.google.guava:guava:jar:19.0:compile",
      "[INFO] \\- org.example:lib:jar:1.0.0:compile",
      "[INFO]    \\- org.slf4j:slf4j-api:jar:1.7.20:compile",
    ].join("\n"),
  );
  const updates = parseDependencyUpdates(
    [
      "[INFO]   com.google.guava:guava ... 19.0 -> 33.6.0-jre",
      "[INFO]   org.slf4j:slf4j-api ...... 1.7.20 -> 2.1.0-alpha1",
    ].join("\n"),
  );
  const merged = mergeDependencyUpdates(nodes, updates);
  assert.equal(merged.length, 2);
  // guava is direct so it sorts ahead of the transitive slf4j.
  assert.equal(merged[0].artifact, "guava");
  assert.equal(merged[0].direct, true);
  assert.equal(merged[0].jump, "major");
  assert.equal(merged[1].direct, false);
  assert.equal(merged[1].via, "org.example:lib");
  // slf4j's latest is a pre-release while the current isn't.
  assert.equal(merged[1].prerelease, true);
});

test("classifyVersionJump distinguishes major / minor / patch", () => {
  assert.equal(classifyVersionJump("1.0.0", "2.0.0"), "major");
  assert.equal(classifyVersionJump("1.2.0", "1.5.0"), "minor");
  assert.equal(classifyVersionJump("1.2.3", "1.2.9"), "patch");
  assert.equal(classifyVersionJump("19.0", "33.6.0-jre"), "major");
  assert.equal(classifyVersionJump("weird", "1.0"), "other");
});

test("isPrerelease detects alpha/beta/rc/milestone/snapshot qualifiers", () => {
  assert.equal(isPrerelease("2.1.0-alpha1"), true);
  assert.equal(isPrerelease("3.0.0-RC1"), true);
  assert.equal(isPrerelease("1.0.0-M2"), true);
  assert.equal(isPrerelease("5.2.0-SNAPSHOT"), true);
  assert.equal(isPrerelease("33.6.0-jre"), false);
  assert.equal(isPrerelease("3.20.0"), false);
});

// Real `gradle dependencies --configuration runtimeClasspath` output (5-char
// indent per level, with a repeated-subtree (*) marker).
const GRADLE_TREE = [
  "",
  "------------------------------------------------------------",
  "Root project 'gradledep'",
  "------------------------------------------------------------",
  "",
  "runtimeClasspath - Runtime classpath of source set 'main'.",
  "+--- com.google.guava:guava:19.0",
  "+--- org.apache.commons:commons-lang3:3.4",
  "+--- org.slf4j:slf4j-api:1.7.20",
  "+--- com.fasterxml.jackson.core:jackson-databind:2.9.0",
  "|    +--- com.fasterxml.jackson.core:jackson-annotations:2.9.0",
  "|    \\--- com.fasterxml.jackson.core:jackson-core:2.9.0",
  "\\--- org.springframework:spring-web:5.2.0.RELEASE",
  "     +--- org.springframework:spring-beans:5.2.0.RELEASE",
  "     |    \\--- org.springframework:spring-core:5.2.0.RELEASE",
  "     |         \\--- org.springframework:spring-jcl:5.2.0.RELEASE",
  "     \\--- org.springframework:spring-core:5.2.0.RELEASE (*)",
  "",
  "(*) - Indicates repeated occurrences of a transitive dependency subtree.",
].join("\n");

test("parseGradleDependencyTree classifies direct vs transitive by indent depth", () => {
  const nodes = parseGradleDependencyTree(GRADLE_TREE);
  const byKey = Object.fromEntries(nodes.map((n) => [n.key, n]));
  assert.equal(byKey["com.google.guava:guava"].direct, true);
  assert.equal(byKey["com.google.guava:guava"].version, "19.0");
  assert.equal(byKey["com.google.guava:guava"].scope, "runtime");
  // jackson-core is a transitive dep pulled in by jackson-databind.
  assert.equal(byKey["com.fasterxml.jackson.core:jackson-core"].direct, false);
  assert.equal(byKey["com.fasterxml.jackson.core:jackson-core"].via, "com.fasterxml.jackson.core:jackson-databind");
  // spring-jcl is several levels deep but its `via` is still the direct ancestor.
  assert.equal(byKey["org.springframework:spring-jcl"].direct, false);
  assert.equal(byKey["org.springframework:spring-jcl"].via, "org.springframework:spring-web");
});

test("parseGradleDependencyTree keeps the shallowest occurrence and ignores (*)", () => {
  const nodes = parseGradleDependencyTree(GRADLE_TREE);
  const core = nodes.filter((n) => n.key === "org.springframework:spring-core");
  // The (*) repeat at depth 1 wins over the depth-2 first occurrence, but it is
  // still transitive, and deduped to a single node.
  assert.equal(core.length, 1);
  assert.equal(core[0].direct, false);
});

test("parseGradleDependencyTree resolves version coercion (a -> b)", () => {
  const nodes = parseGradleDependencyTree(
    [
      "runtimeClasspath - Runtime classpath.",
      "+--- org.slf4j:slf4j-api:1.7.20 -> 2.0.13",
      "\\--- com.example:lib -> 3.1.0",
    ].join("\n"),
  );
  const byKey = Object.fromEntries(nodes.map((n) => [n.key, n]));
  assert.equal(byKey["org.slf4j:slf4j-api"].version, "2.0.13");
  // A constraint-only line (no requested version) still resolves via the arrow.
  assert.equal(byKey["com.example:lib"].version, "3.1.0");
});

test("gradleDepConfigFilter keeps real dependency classpaths and drops internal configs", () => {
  for (const ok of [
    "compileClasspath",
    "runtimeClasspath",
    "testCompileClasspath",
    "testRuntimeClasspath",
    "productionRuntimeClasspath",
    "integrationTestRuntimeClasspath",
    "annotationProcessor",
    "testAnnotationProcessor",
    "developmentOnly",
    "testAndDevelopmentOnly",
  ]) {
    assert.equal(gradleDepConfigFilter(ok), true, `${ok} should be a dependency classpath`);
  }
  for (const no of [
    "kotlinCompilerPluginClasspathMain",
    "kotlinBuildToolsApiClasspath",
    "kotlinCompilerClasspath",
    "apiElements",
    "runtimeElements",
    "mainSourceElements",
    "implementationDependenciesMetadata",
    "default",
    "archives",
  ]) {
    assert.equal(gradleDepConfigFilter(no), false, `${no} should be excluded`);
  }
});

test("parseGradleDependencyTree with a configFilter ignores internal plugin configs", () => {
  // A real-world multi-config report: a plugin/compiler classpath that the user
  // does not declare, plus the compile/test classpaths that they do.
  const tree = [
    "kotlinCompilerPluginClasspathMain - Kotlin compiler plugins for compilation",
    "\\--- org.jetbrains.kotlin:kotlin-allopen-compiler-plugin-embeddable:2.2.0",
    "",
    "compileClasspath - Compile classpath for source set 'main'.",
    "+--- com.example:app-lib:1.0",
    "|    \\--- com.example:shared:1.0",
    "",
    "testRuntimeClasspath - Runtime classpath of source set 'test'.",
    "\\--- org.junit.jupiter:junit-jupiter:5.10.0",
    "     \\--- org.junit.jupiter:junit-jupiter-api:5.10.0",
    "",
  ].join("\n");
  const nodes = parseGradleDependencyTree(tree, { configFilter: gradleDepConfigFilter });
  const byKey = Object.fromEntries(nodes.map((n) => [n.key, n]));
  // The compiler-plugin artifact lives only in a kotlin* config and is dropped.
  assert.equal(byKey["org.jetbrains.kotlin:kotlin-allopen-compiler-plugin-embeddable"], undefined);
  // Declared deps are direct; their transitive children are transitive.
  assert.equal(byKey["com.example:app-lib"].direct, true);
  assert.equal(byKey["com.example:shared"].direct, false);
  assert.equal(byKey["org.junit.jupiter:junit-jupiter"].direct, true);
  assert.equal(byKey["org.junit.jupiter:junit-jupiter-api"].direct, false);
  // Without the filter every configuration is parsed, including the kotlin one.
  const all = parseGradleDependencyTree(tree);
  assert.ok(all.some((n) => n.key === "org.jetbrains.kotlin:kotlin-allopen-compiler-plugin-embeddable"));
});

test("parseGradleDependencyUpdates reads the ben-manes JSON outdated list", () => {
  const json = JSON.stringify({
    outdated: {
      dependencies: [
        { group: "com.google.guava", name: "guava", version: "19.0", available: { release: "33.6.0-jre" } },
        {
          group: "org.slf4j",
          name: "slf4j-api",
          version: "1.7.20",
          available: { release: "2.1.0-alpha1", milestone: null },
        },
        {
          group: "no.latest",
          name: "lib",
          version: "1.0",
          available: { release: null, milestone: null, integration: null },
        },
      ],
    },
  });
  const map = parseGradleDependencyUpdates(json);
  assert.equal(map.get("com.google.guava:guava").latest, "33.6.0-jre");
  assert.equal(map.get("org.slf4j:slf4j-api").latest, "2.1.0-alpha1");
  // A dependency with no available version is dropped.
  assert.equal(map.has("no.latest:lib"), false);
});

test("parseGradleDependencyUpdates returns an empty map on malformed JSON", () => {
  assert.equal(parseGradleDependencyUpdates("not json").size, 0);
  assert.equal(parseGradleDependencyUpdates("{}").size, 0);
});

test("mergeDependencyUpdates joins a Gradle tree + ben-manes report", () => {
  const nodes = parseGradleDependencyTree(GRADLE_TREE);
  const updMap = parseGradleDependencyUpdates(
    JSON.stringify({
      outdated: {
        dependencies: [
          { group: "com.google.guava", name: "guava", version: "19.0", available: { release: "33.6.0-jre" } },
          {
            group: "org.springframework",
            name: "spring-core",
            version: "5.2.0.RELEASE",
            available: { release: "6.1.0" },
          },
        ],
      },
    }),
  );
  const merged = mergeDependencyUpdates(nodes, updMap);
  const byKey = Object.fromEntries(merged.map((m) => [`${m.group}:${m.artifact}`, m]));
  assert.equal(byKey["com.google.guava:guava"].direct, true);
  assert.equal(byKey["com.google.guava:guava"].jump, "major");
  assert.equal(byKey["org.springframework:spring-core"].direct, false);
  assert.equal(byKey["org.springframework:spring-core"].via, "org.springframework:spring-web");
});
