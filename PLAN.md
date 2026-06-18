# Coffilot Plan

## Vision

Coffilot is the Java inner-loop console for the GitHub Copilot app: a canvas that
lets you build, test, package and run a Maven or Gradle Java / Spring Boot / Quarkus
project, watch it live, and hand failures straight to the agent — without leaving the
chat. It degrades gracefully from plain Java up to a BootUI-instrumented Spring Boot
app, surfacing richer data when the project provides it.

Principles, in priority order:

1. **Stay local and safe.** The loopback server binds to `127.0.0.1`; mutating
   actions are explicit; nothing leaves the machine.
2. **Zero-config where possible.** Detect the build tool (Maven or Gradle), modules,
   profiles, Spring Boot / Quarkus, Actuator and BootUI from the build files and the
   running app rather than asking the user.
3. **Fast inner loop.** Parallel Build/Test/Package and Run lanes, optional warm
   JVM via `mvnd` / the Gradle daemon, live streaming output.
4. **Useful failures.** Every failure offers a context-rich "Fix with Copilot".
5. **Simple, themed UI** that matches the Copilot app.

## Current state

Shipped in the extension today:

- Build / Test / Package / Run lanes with live SSE-streamed console output, a
  graphical JUnit test view with a live progress bar, and a console toggle.
- **Debug lane** alongside Run: relaunches the app with the JDWP agent enabled
  (loopback only) and attaches a self-contained JDWP debugger (`jdwp.mjs`, no
  external DAP/JDTLS dependency). Breakpoints (armed on class-prepare, so they can
  be set before launch), continue, step in/over/out, pause, paused call stack,
  frame-local variables and a dotted-path evaluator. Per-build-tool agent injection
  (plain Java argv, Spring Maven `-Dspring-boot.run.jvmArguments`, a generated Gradle
  init-script for Spring/app Gradle, Quarkus `-Ddebug`). Debug and Run are mutually
  exclusive (shared app slot); DevTools is ignored while debugging (live reload off
  and `spring.devtools.restart.enabled=false` on the app JVM).
- **Maven and Gradle support**, auto-detected from project markers (Maven preferred
  when both are present; a clear degraded notice when neither is). The wrapper
  (`./mvnw` / `./gradlew`) is preferred over a system `mvn` / `gradle`, cross-platform.
- Build group (Build/Test/Package) running independently of the long-lived Run lane.
- Module scan for runnable apps (Maven reactor / Gradle subprojects), Spring Boot
  and Quarkus detection, and run-profile discovery (Spring `application-<profile>.*`
  files and Maven profiles for Maven; Quarkus `dev`/`test`/`prod` + `%<profile>.` keys).
- Generic runner when a module is neither a Spring Boot nor a Quarkus app: the Gradle
  `application` plugin's `run` task, else an executable jar via `java -jar`, else the
  module's configured main class via `java -cp` (Maven resolves the runtime classpath
  with `dependency:build-classpath`).
- Optional warm builds via the Maven Daemon (`mvnd`) or the Gradle daemon,
  cross-platform detected.
- Live JVM metrics tiered BootUI → Actuator → Quarkus Micrometer/health → process,
  with a source badge.
- Live log viewer on the Run console (minimum-severity filter + text search, with
  severity-colored lines and inherited levels for stack traces) and runtime log-level
  control via Spring Boot Actuator `/loggers` or the Quarkus `quarkus-logging-manager`
  extension (a Loggers side tab + the `set_log_level` action), so loggers can be
  changed live without a restart.
- On-demand CPU / allocation / wall-clock / lock-contention flame graph of the
  running app via async-profiler (`asprof`) when present, or the JDK-bundled JDK
  Flight Recorder (`jcmd JFR.*`) as a cross-platform fallback (so flame graphs work
  on Windows too), rendered interactively (zoom, hover, search) in the Run tab with
  a top-hotspots list; an "Automatically record at startup" toggle (off by default)
  records on each app start. Detected and degraded gracefully when neither engine is
  available.
- "Fix with Copilot" for compile, package, test, plain-Java, Spring Boot and Quarkus
  startup failures (including Quarkus dev-mode build/augmentation failures that keep
  the process running), for a running app with no runtime-logger endpoint (offers to
  add Spring Boot Actuator or the Quarkus logging-manager extension), for flame-graph
  hotspots, and for BootUI advisor-scan findings.
- For Spring Boot projects, a dedicated **Spring Boot** side tab (between Loggers and
  BootUI) shows the detected Spring Boot version mapped to a support status (current /
  supported / EOL) from an embedded endoflife.date table, with an "Upgrade with Copilot"
  action when behind the latest GA, plus DevTools controls (Add DevTools, Enable live
  reload, Live reload / Restart app).
- BootUI advisor scans run over REST (BootUI tab), plus an optional MCP-server
  toggle/register bridge, when the running app exposes BootUI.
- Quarkus Agent MCP: a dedicated **Quarkus** right-panel tab with a "Register with
  Copilot" button (JBang, or `java -jar`
  fallback) that wires the external [quarkus-agent-mcp](https://github.com/quarkusio/quarkus-agent-mcp)
  server into the Copilot CLI config, plus one-click capability prompts (extension
  skills, docs search, last exception). Coffilot detects and registers it but does
  not host or proxy it; shown for Quarkus projects when JBang/Java is available. The
  Quarkus startup "Fix with Copilot" prompt also prefers `devui-exceptions_getLastException`
  for structured failure data when the server is registered.
- Per-project persisted settings (warm JVM, Spring profiles, devtools, random port,
  auto-open browser, auto-record flame graph at startup, and the last-opened
  right-panel tab / collapsed state) and an always-visible Settings panel that opens
  on first launch.
- `--enable-native-access=ALL-UNNAMED` applied to the build-tool JVM (via
  `MAVEN_OPTS` / `GRADLE_OPTS`) and, for Maven, the app JVM to silence JDK
  native-access warnings.
- Agent-facing actions: `build_app`, `run_tests`, `run_affected_tests`,
  `package_app`, `start_app`, `stop_app`, `get_status`, `get_metrics`,
  `profile_app`, `fix_issue`, `run_scan`, `set_log_level`, plus the debug actions
  `start_debug`, `stop_debug`, `set_breakpoint`, `remove_breakpoint`,
  `debug_continue`, `debug_step`, `debug_stack`, `get_variables`, `debug_evaluate`
  and `debug_status`.

## Known limitations

- **Live state is in-memory** and single-app (one build lane + one Run at a time).
  Live processes (a running app, an attached debugger) do not survive an extension
  reload, but each lane's recent terminal results are persisted and restored so the
  canvas shows the last Build/Test/Package/Run outcome immediately after a reload.
- **Run output is raw build-tool / app stdout**, but it now passes through a
  conservative secret masker before streaming to the iframe and before sending
  "fix" context (toggle via the `maskSecrets` setting). Masking is heuristic, so
  unusual secret formats can still slip through.
- **Port detection is best-effort.** Coffilot first scrapes the startup banner
  (Tomcat / Netty / Undertow, plus Quarkus' "Listening on" line) and, when no
  recognised line appears, falls back to probing the running app's process tree
  for a LISTENing HTTP port (`ps` + `lsof`, POSIX only). If neither finds a port —
  e.g. a fully custom banner on Windows — metrics simply stay unavailable.
- **The debug evaluator is a field-path resolver, not a Java expression compiler.** It
  resolves a local (or `this`) and walks dotted instance-field paths (e.g.
  `order.customer.name`); it does not call methods or evaluate arbitrary expressions.
  Frame-local variables also require classes compiled with debug info (`-g`, the
  default for Maven/Gradle). The Quarkus-on-Gradle `-Ddebug` forwarding is
  best-effort and unverified.
- **The flame graph prefers async-profiler** (richer events) when installed, and
  otherwise falls back to JDK Flight Recorder via `jcmd` (bundled with every JDK,
  including on Windows). It resolves the app JVM via `lsof` on the detected HTTP port
  (falling back to the run lane's child for plain-`java` runs, and to `jcmd -l`/`jps`
  when `lsof` is unavailable, e.g. on Windows), so a port-less app started through a
  forked wrapper can still usually be attached to. On macOS the async-profiler `cpu`
  event maps to `itimer` (no perf_events). Flame graphs are only unavailable when
  neither async-profiler nor a JDK `jcmd` can be found.

## Roadmap

Near-term, roughly in priority order:

- [x] Mask obvious secrets in streamed build/run output and in "fix" context.
- [x] Persist recent lane history / last results across reloads.
- [x] Surface test output filtering (only-failures, search) in the graphical view.
- [x] Make the metrics poll interval configurable from Settings.
- [x] Add a lightweight automated check for the iframe UI (jsdom smoke test of
      `public/index.html` + `public/app.js`) wired into CI alongside `npm run check`,
      plus `node:test` unit tests for the pure parsers/normalizers and an
      integration-project matrix (Maven + Gradle) in CI.
- [ ] Document and test the share-as-gist / install-from-repo round trip.

Explicitly **out of scope**: remote (non-loopback) access, and anything that mutates
the target project's source without an explicit agent action.

## Contributing to the plan

Open an issue to propose a roadmap change. Keep items framed by the principles
above: local-first, zero-config, fast, and useful on failure.
