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
  maskSecrets,
  buildHistoryEntry,
  clampHistory,
  clampMetricsPollMs,
  parseJfrStacks,
  pickAppPidFromJvmList,
  quarkusDevConsoleFailed,
  jdkSupportsNativeAccess,
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
