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
- "Fix with Copilot" for compile, package, test, plain-Java, Spring Boot and Quarkus
  startup failures, and for BootUI advisor-scan findings.
- BootUI MCP server toggle + advisor scans when the running app exposes BootUI.
- Per-project persisted settings (warm JVM, Spring profiles, devtools, random port,
  auto-open browser) and an always-visible Settings panel.
- `--enable-native-access=ALL-UNNAMED` applied to the build-tool JVM (via
  `MAVEN_OPTS` / `GRADLE_OPTS`) and, for Maven, the app JVM to silence JDK
  native-access warnings.
- Agent-facing actions: `build_app`, `run_tests`, `package_app`, `start_app`,
  `stop_app`, `get_status`, `get_metrics`, `fix_issue`, `run_scan`.

## Known limitations

- **State is in-memory** and single-app (one build lane + one Run at a time). It is
  reset on extension reload rather than persisted.
- **Run output is raw build-tool / app stdout** — unlike BootUI's API it is not run
  through a secret masker, so build output could echo secrets. Hardening this means
  masking before streaming to the iframe and before sending "fix" context.
- **Port detection is log-regex based** (Tomcat / Netty / Undertow, plus Quarkus'
  "Listening on" banner). A custom startup banner can hide the port, in which case
  metrics simply stay unavailable.
- **No live per-test progress for Gradle.** Maven's Surefire console output drives the
  class-by-class progress bar; Gradle's graphical test view fills in from the final
  JUnit XML report instead.

## Roadmap

Near-term, roughly in priority order:

- [ ] Mask obvious secrets in streamed build/run output and in "fix" context.
- [ ] Persist recent lane history / last results across reloads.
- [ ] Surface test output filtering (only-failures, search) in the graphical view.
- [ ] Make the metrics poll interval and endpoints configurable from Settings.
- [ ] Add a lightweight automated check for `public/index.html` (jsdom smoke test)
      wired into CI alongside `npm run check`.
- [ ] Document and test the share-as-gist / install-from-repo round trip.

Explicitly **out of scope**: remote (non-loopback) access, and anything that mutates
the target project's source without an explicit agent action.

## Contributing to the plan

Open an issue to propose a roadmap change. Keep items framed by the principles
above: local-first, zero-config, fast, and useful on failure.
