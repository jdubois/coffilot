# Coffilot

[![Build](https://github.com/jdubois/coffilot/actions/workflows/ci.yml/badge.svg)](https://github.com/jdubois/coffilot/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

**Coffilot** is a [GitHub Copilot **canvas extension**](https://docs.github.com/en/copilot/how-tos/github-copilot-app/working-with-canvas-extensions)
that turns a Maven- or Gradle-based Java / Spring Boot / Quarkus project into an
interactive console in the Copilot app's side panel. Build, test, package and run your
app, watch live JVM metrics, and — when something breaks — push the failure straight
back to the agent with **Fix with Copilot**.

> Coffee for your Copilot: brew, taste and ship your Java app without leaving the chat. ☕

The build tool is auto-detected: **Maven** (`pom.xml` / `./mvnw`) is used when present;
otherwise **Gradle** (`build.gradle[.kts]` / `./gradlew`). When both are present Maven
wins; when neither is found the console says so and stays disabled until one is added.

## Features

- **Build** &mdash; Maven `./mvnw -ntp -DskipTests install` or Gradle
  `./gradlew build -x test` (args overridable). A **Clean** toggle (off by default)
  runs a clean first (`mvn clean install`; Gradle `clean build`).
- **Test** &mdash; Maven `./mvnw -ntp test` or Gradle `./gradlew cleanTest test`, with
  the JUnit results parsed into a graphical, per-test view (summary chips, per-suite
  grouping, expandable failure stack traces) and a live progress bar. A console toggle
  shows the raw output.
- **Run affected** &mdash; a mode
  that runs only the tests relevant to your **uncommitted changes** (git working tree
  vs `HEAD`) instead of the whole suite. Coffilot builds a dependency graph from the
  compiled `.class` files (reading each class's constant pool, no extra dependencies)
  and runs just the test classes that transitively depend on the changed code — via
  Surefire `-Dtest=…` (Maven) or `--tests …` (Gradle). Build once for
  dependency-accurate selection; before the first compile it falls back to a name-based
  mapping (`Foo` → `FooTest` / `FooTests` / `FooIT`).
- **Package** &mdash; Maven `./mvnw -ntp package` or Gradle `./gradlew assemble`,
  streamed live like Build. A **Clean** toggle (off by default) runs a clean first
  (`mvn clean package`; Gradle `clean assemble`), and an **Install** toggle (off by
  default) installs the artifact to the local repository (`mvn install`; Gradle
  `publishToMavenLocal`) instead of just packaging.
- **Run** &mdash; `spring-boot:run` (Maven) / `bootRun` (Gradle) for a Spring Boot
  module (+ Spring profiles), `quarkus:dev` (Maven) / `quarkusDev` (Gradle) for a
  Quarkus module (+ run profile), or, for a non-Spring/non-Quarkus module, the
  **generic runner**: the Gradle `application` plugin's `run` task, else build +
  `java -jar` for an executable jar, else the configured main class via `java -cp`.
  Optionally opens a browser window at the app once it is up.
- **Parallel lanes** &mdash; Build / Test / Package share one build lane while Run
  is independent, so you can keep the app running while you re-test.
- **Debug** &mdash; launches the app exactly like Run but with the **JDWP** agent
  enabled (`-agentlib:jdwp=…server=y,address=127.0.0.1:<port>`, loopback only) and a
  self-contained JDWP debugger attached &mdash; no external DAP server or language
  server required. The Debug tab drives breakpoints, continue, step in/over/out,
  pause, the paused call stack, frame-local variables and a dotted-path evaluator.
  Debug and Run are **mutually exclusive** (they share the single app slot), and
  Copilot can drive the whole session through agent actions (set a breakpoint,
  continue, inspect variables, …). DevTools is ignored while debugging — Coffilot's
  live reload stays off and DevTools' own restart is disabled (via
  `spring.devtools.restart.enabled=false`) so a recompile or restart can't drop the
  session.
- **Stop** &mdash; terminates the running app / build process.
- **Profiles** &mdash; the toolbar scans the project for available run profiles —
  **Spring Boot** profiles (`application-<profile>.*`) or **Quarkus** profiles
  (`dev` / `test` / `prod` plus any `%<profile>.` keys) — and, for Maven, the reactor's
  **Maven profiles**, offering each as an editable dropdown. (Gradle has no Maven-profile
  concept, so that control is hidden.)
- **Refresh** &mdash; the refresh button in the toolbar's top-right corner re-runs the
  project discovery done at launch (build tool, modules, Maven/Spring/Quarkus profiles
  and detected technologies), so changes to the build files show up without reloading
  the extension.
- **New version available** &mdash; when Coffilot is run from its own git checkout
  (you cloned it, or forked and cloned it), it checks a minute after launch whether the
  checkout is behind its remote. If newer commits exist, a **New version available**
  button appears next to **Refresh**; clicking it runs `git pull --ff-only` and then
  prompts you to restart the extension and re-open the canvas. The button stays hidden
  when there's nothing to pull, or when Coffilot was copied into another repository or
  onto disk without its own `.git`.
- **Live JVM metrics** &mdash; once the app is up, the panel shows heap / non-heap,
  threads, health, profiles and startup info, sourced from the richest endpoint
  available (BootUI → Actuator → Quarkus Micrometer/health → process).
- **Live logs &amp; log levels** &mdash; the Run console doubles as a log viewer with a
  minimum-severity filter and text search (stack-trace lines inherit their parent
  level, and lines are colored by severity). A **Loggers** side tab lists the running
  app's loggers from Spring Boot Actuator <code>/loggers</code> and lets you change any
  level live &mdash; no restart &mdash; so you can flip a package to <code>DEBUG</code>,
  reproduce, and dial it back.
- **Flame graph (async-profiler or JFR)** &mdash; when [async-profiler](https://github.com/async-profiler/async-profiler)
  (`asprof`) is installed, the Run tab's **Flame graph** view records an on-demand
  CPU / allocation / wall-clock / lock-contention profile of the running app's JVM
  and renders an interactive flame graph (zoom, hover, search) plus a **Top
  hotspots** list. When async-profiler isn't present, Coffilot falls back to the
  JDK-bundled JDK Flight Recorder (via `jcmd`), so flame graphs also work on
  Windows. An **Analyze hotspots with Copilot** button sends the hottest
  methods to the agent. An **Automatically record at startup** toggle (off by
  default) kicks off a recording on its own each time the app becomes reachable.
  Degrades gracefully with an install hint only when neither async-profiler nor a
  JDK `jcmd` is available.
- **Fix with Copilot** &mdash; on a compile error, failing tests, a startup
  crash, or a Quarkus dev-mode build/augmentation failure (where the process stays
  up waiting for a fix), a button pushes a context-rich request back into the chat
  so the agent can diagnose and fix it.
- **Responsive layout** &mdash; on a wide canvas the **Live JVM / Loggers / Settings**
  panel is docked on the right; as the canvas narrows it collapses to an icon rail on
  the right edge, and tapping an icon slides that pane out as an overlay over the main
  console. A toggle button (the chevron in the panel's tab bar / rail) hides or shows
  the panel on demand in any layout &mdash; even when docked &mdash; so you can give the
  console the full width (tap a rail icon, the chevron, or press <kbd>Esc</kbd> to
  bring it back).
- **Keep the JVM warm** &mdash; optionally use the [Maven Daemon (`mvnd`)](https://github.com/apache/maven-mvnd)
  (Maven) or the always-on **Gradle daemon** for Build / Test / Package so repeat runs
  skip JVM startup and JIT warmup.
- **Switch JDK** &mdash; a **JDK** selector in **Settings** runs every action
  (Build / Test / Package / Run / Debug) under the JDK you pick. JDKs are
  auto-discovered &mdash; primarily from [SDKMAN](https://sdkman.io)
  (`~/.sdkman/candidates/java/*`), then OS-standard install locations and your
  `JAVA_HOME` &mdash; and applied by injecting `JAVA_HOME` into the build/run
  environment (no `sdk use` shelling out). **Auto** keeps the system default; the
  active JDK is shown as a pill next to the build tool. The change takes effect on
  the next launch, so stop a running app before switching.
- **Advisor scans (with BootUI)** &mdash; when the running app exposes
  [BootUI](https://github.com/jdubois/boot-ui), the **Scans** tab lists its advisor
  scans (architecture, Spring, security, Hibernate, …) and runs them directly over
  BootUI's REST API; findings can be sent to the agent with one click. A separate
  **Register with Copilot** button can also enable BootUI's in-app MCP server and wire
  it into the Copilot CLI config so the agent can call the scans as native MCP tools.

## Graceful degradation by capability

The console adapts to whatever the project provides, detected from the build files
(static) and confirmed against the running app (runtime):

| Tier                          | Detected from                                     | What the console offers                                                                                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **(none)**                    | no Maven or Gradle markers                        | A "needs Maven or Gradle" notice; the Build / Test / Package / Run actions stay disabled                                                                                                                                                |
| **Java** (base)               | `pom.xml` / `mvnw` or `build.gradle` / `gradlew`  | Build, Test (graphical JUnit report), Package                                                                                                                                                                                           |
| **Spring Boot**               | Spring Boot Maven plugin / Gradle plugin          | Run via `spring-boot:run` (Maven) or `bootRun` (Gradle) + editable Spring profiles. (No Spring Boot ⇒ the generic runner uses the Gradle `application` plugin, an executable `java -jar`, or the configured main class via `java -cp`.) |
| **Quarkus**                   | Quarkus Maven plugin / `io.quarkus` Gradle plugin | Run via `quarkus:dev` (Maven) or `quarkusDev` (Gradle) — dev mode with built-in live reload — + editable Quarkus profile                                                                                                                |
| **Actuator** (runtime)        | `/actuator/*` or `/management/*` answers          | Live metrics normalized from Actuator — JSON `/metrics` endpoint or the Prometheus scrape (heap, threads, health, uptime) — plus runtime log-level control when `/loggers` is exposed                                                   |
| **Quarkus metrics** (runtime) | `/q/metrics` / `/q/health` answer                 | Live metrics normalized from Quarkus Micrometer (Prometheus) + SmallRye Health                                                                                                                                                          |
| **BootUI** (runtime)          | `/bootui/api/*` answers                           | Rich BootUI metrics **and** the REST advisor-scan panel (Scans tab)                                                                                                                                                                     |

A capability summary is shown in the status bar (including the active build tool), and
the metrics panel carries a small badge (`BootUI` / `Actuator` / `Quarkus` / `process`)
indicating which source is live.

## Requirements

- The [GitHub Copilot app](https://docs.github.com/en/copilot) or Copilot CLI with
  canvas-extension support.
- A target project built with **Maven** or **Gradle** on **Java 17+**. The committed
  wrapper (`./mvnw` or `./gradlew`) is used when present, otherwise a system `mvn` /
  `gradle` on `PATH`. Works on macOS, Linux and Windows. If both build tools are
  present, Maven is used.
- Optional: [`mvnd`](https://github.com/apache/maven-mvnd) for warm Maven builds (the
  Gradle daemon serves the same role and is always available), and
  [BootUI](https://github.com/jdubois/boot-ui) on the target app for the richest
  metrics and advisor scans.

## Install

Coffilot is a Copilot **extension**: it lives in a `.github/extensions/coffilot/`
folder (committed to a repo, shared with the team) or in
`$COPILOT_HOME/extensions/coffilot/` (`~/.copilot/extensions/coffilot/`, just for
you).

### From the Copilot app

Use **Install extension from repo…** (or the `install_extension` action) and point
it at this repository:

```
https://github.com/jdubois/coffilot
```

Choose **project** scope to commit it into the current repo's
`.github/extensions/`, or **user** scope to install it just for you.

### Manually

Copy the extension files into the target location, keeping the folder name
`coffilot`:

```bash
# Project scope (committed to the repo you want to drive):
mkdir -p .github/extensions/coffilot
cp -R extension.mjs copilot-extension.json public .github/extensions/coffilot/

# Or user scope (available in every session):
mkdir -p ~/.copilot/extensions/coffilot
cp -R extension.mjs copilot-extension.json public ~/.copilot/extensions/coffilot/
```

Reload extensions (or restart the session); Coffilot is then discovered
automatically (`canvasId: java-app`).

### This repository

This repo dog-foods Coffilot: it ships a tiny
`.github/extensions/coffilot/extension.mjs` wrapper that loads the root
`extension.mjs`, so opening **this** repository in the Copilot app loads Coffilot
by default — no manual install or `~/.copilot/extensions/coffilot` symlink needed.
If you already have such a user-scope symlink, remove it when working in this repo
so Coffilot isn't loaded twice.

## Use

In a Copilot app session on a Maven or Gradle project, open the **Coffilot** canvas, then:

1. **Build** to compile the project (first run), or **Run** to start an app (pick a
   module and a run profile).
2. Watch the console stream the build-tool / app output.
3. Once the app is up, watch the **Live JVM metrics** panel populate (badge:
   `BootUI` / `Actuator` / `Quarkus` / `process`).
4. If something fails, click **Fix with Copilot** to hand the error to the agent.
5. Or **Debug** instead of Run to launch under the debugger: open the **Debug** tab,
   add a breakpoint (class binary name + line), and use Continue / Step / Pause; the
   paused call stack, frame variables and an evaluator appear inline.
6. **Stop** when done.

The agent can drive the same flow with the `build_app`, `run_tests`,
The agent can drive the same flow with the `build_app`, `run_tests`,
`run_affected_tests`, `package_app`, `start_app`, `stop_app`, `get_status`,
`get_metrics`, `profile_app`, `fix_issue`, `run_scan` and `set_log_level` actions,
plus the debug actions `start_debug`, `stop_debug`, `set_breakpoint`,
`remove_breakpoint`, `debug_continue`, `debug_step`, `debug_stack`,
`get_variables`, `debug_evaluate` and `debug_status`.

## How it works

Coffilot is a Node process (the extension) that:

- shells out to the project's build tool — `./mvnw` / `mvn` / `mvnd` for Maven, or
  `./gradlew` / `gradle` for Gradle — for Build / Test / Package / Run and streams the
  output into the canvas over Server-Sent Events;
- parses the JUnit XML reports (Maven Surefire or Gradle `build/test-results`) into a
  graphical test view;
- once an app is up, polls it for live metrics from the richest source available,
  proxying [BootUI](https://github.com/jdubois/boot-ui)'s sanitized `/bootui/api/**`
  DTOs when present and falling back to Spring Boot Actuator, then to Quarkus
  Micrometer/health (`/q/*`), then to coarse process metrics;
- for **Debug**, relaunches the app with the JDWP agent enabled (injected per build
  tool: directly into the `java` argv for plain Java, via
  `-Dspring-boot.run.jvmArguments` for Spring Maven, a generated Gradle init-script
  for Spring/app Gradle, or Quarkus's built-in `-Ddebug` for Quarkus) and attaches a
  self-contained JDWP client (`jdwp.mjs`, loopback only) that the UI and agent
  actions drive;
- proxies Spring Boot Actuator `/loggers` so the canvas can read and change logger
  levels on the running app without a restart;
- runs BootUI's advisor scans straight from its REST API (`/bootui/api/panels` to
  discover them, `POST /bootui/api/{id}/scan` to run one), surfaced in the **Scans**
  tab — no in-app MCP server required;
- pushes contextual "fix this" turns back into the chat through the Copilot SDK.

The loopback HTTP server that backs the iframe binds to `127.0.0.1` only. See
[docs/ARCHITECTURE notes in `extension.mjs`](extension.mjs) for the wiring and
[SECURITY.md](SECURITY.md) for the threat model.

## Project resources

- [PLAN.md](PLAN.md) &mdash; roadmap and known limitations.
- [CONTRIBUTING.md](CONTRIBUTING.md) &mdash; how to develop and test the extension.
- [SECURITY.md](SECURITY.md) &mdash; threat model and reporting.
- [CHANGELOG is tracked via releases](https://github.com/jdubois/coffilot/releases).

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
