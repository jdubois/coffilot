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
  `./gradlew build -x test` (args overridable).
- **Test** &mdash; Maven `./mvnw -ntp test` or Gradle `./gradlew cleanTest test`, with
  the JUnit results parsed into a graphical, per-test view (summary chips, per-suite
  grouping, expandable failure stack traces) and a live progress bar. A console toggle
  shows the raw output.
- **Run affected** &mdash; an [Infinitest](https://infinitest.github.io/)-style mode
  that runs only the tests relevant to your **uncommitted changes** (git working tree
  vs `HEAD`) instead of the whole suite. Coffilot builds a dependency graph from the
  compiled `.class` files (reading each class's constant pool, no extra dependencies)
  and runs just the test classes that transitively depend on the changed code — via
  Surefire `-Dtest=…` (Maven) or `--tests …` (Gradle). Build once for
  dependency-accurate selection; before the first compile it falls back to a name-based
  mapping (`Foo` → `FooTest` / `FooTests` / `FooIT`).
- **Package** &mdash; Maven `./mvnw -ntp package` or Gradle `./gradlew assemble`,
  streamed live like Build.
- **Run** &mdash; `spring-boot:run` (Maven) / `bootRun` (Gradle) for a Spring Boot
  module (+ Spring profiles), `quarkus:dev` (Maven) / `quarkusDev` (Gradle) for a
  Quarkus module (+ run profile), or, for a non-Spring/non-Quarkus module, the
  **generic runner**: the Gradle `application` plugin's `run` task, else build +
  `java -jar` for an executable jar, else the configured main class via `java -cp`.
  Optionally opens a browser window at the app once it is up.
- **Parallel lanes** &mdash; Build / Test / Package share one build lane while Run
  is independent, so you can keep the app running while you re-test.
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
- **Live JVM metrics** &mdash; once the app is up, the panel shows heap / non-heap,
  threads, health, profiles and startup info, sourced from the richest endpoint
  available (BootUI → Actuator → Quarkus Micrometer/health → process).
- **Fix with Copilot** &mdash; on a compile error, failing tests, or a startup
  crash, a button pushes a context-rich request back into the chat so the agent
  can diagnose and fix it.
- **Keep the JVM warm** &mdash; optionally use the [Maven Daemon (`mvnd`)](https://github.com/apache/maven-mvnd)
  (Maven) or the always-on **Gradle daemon** for Build / Test / Package so repeat runs
  skip JVM startup and JIT warmup.
- **Advisor scans (with BootUI)** &mdash; when the running app exposes
  [BootUI](https://github.com/jdubois/boot-ui), a toggle enables its MCP server and
  the advisor scans (architecture, Spring, security, Hibernate, …); findings can be
  sent to the agent with one click. A **Register with Copilot** button can also wire
  the running MCP server into the Copilot CLI config so the agent can call the scans
  directly as native MCP tools.

## Graceful degradation by capability

The console adapts to whatever the project provides, detected from the build files
(static) and confirmed against the running app (runtime):

| Tier                          | Detected from                                     | What the console offers                                                                                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **(none)**                    | no Maven or Gradle markers                        | A "needs Maven or Gradle" notice; the Build / Test / Package / Run actions stay disabled                                                                                                                                                |
| **Java** (base)               | `pom.xml` / `mvnw` or `build.gradle` / `gradlew`  | Build, Test (graphical JUnit report), Package                                                                                                                                                                                           |
| **Spring Boot**               | Spring Boot Maven plugin / Gradle plugin          | Run via `spring-boot:run` (Maven) or `bootRun` (Gradle) + editable Spring profiles. (No Spring Boot ⇒ the generic runner uses the Gradle `application` plugin, an executable `java -jar`, or the configured main class via `java -cp`.) |
| **Quarkus**                   | Quarkus Maven plugin / `io.quarkus` Gradle plugin | Run via `quarkus:dev` (Maven) or `quarkusDev` (Gradle) — dev mode with built-in live reload — + editable Quarkus profile                                                                                                                |
| **Actuator** (runtime)        | `/actuator/*` or `/management/*` answers          | Live metrics normalized from Actuator — JSON `/metrics` endpoint or the Prometheus scrape (heap, threads, health, uptime)                                                                                                               |
| **Quarkus metrics** (runtime) | `/q/metrics` / `/q/health` answer                 | Live metrics normalized from Quarkus Micrometer (Prometheus) + SmallRye Health                                                                                                                                                          |
| **BootUI** (runtime)          | `/bootui/api/*` answers                           | Rich BootUI metrics **and** the MCP advisor-scan panel                                                                                                                                                                                  |

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
5. **Stop** when done.

The agent can drive the same flow with the `build_app`, `run_tests`,
`run_affected_tests`, `package_app`, `start_app`, `stop_app`, `get_status`,
`get_metrics`, `fix_issue` and `run_scan` actions.

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
