# Coffilot

[![Build](https://github.com/jdubois/coffilot/actions/workflows/ci.yml/badge.svg)](https://github.com/jdubois/coffilot/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

**Coffilot** is a [GitHub Copilot **canvas extension**](https://docs.github.com/en/copilot/how-tos/github-copilot-app/working-with-canvas-extensions)
that turns a Maven-based Java / Spring Boot project into an interactive console in
the Copilot app's side panel. Build, test, package and run your app, watch live
JVM metrics, and — when something breaks — push the failure straight back to the
agent with **Fix with Copilot**.

> Coffee for your Copilot: brew, taste and ship your Java app without leaving the chat. ☕

## Features

- **Build** &mdash; `./mvnw -ntp -DskipTests install` (args overridable).
- **Test** &mdash; `./mvnw -ntp test`, with the Surefire results parsed into a
  graphical, per-test view (summary chips, per-suite grouping, expandable failure
  stack traces) and a live progress bar. A console toggle shows the raw output.
- **Package** &mdash; `./mvnw -ntp package`, streamed live like Build.
- **Run** &mdash; `spring-boot:run` for a Spring Boot module (+ Spring profiles),
  or **package + `java -jar`** for a plain-Java module. Optionally opens a browser
  window at the app once it is up.
- **Parallel lanes** &mdash; Build / Test / Package share one Maven lane while Run
  is independent, so you can keep the app running while you re-test.
- **Stop** &mdash; terminates the running app / Maven process.
- **Profiles** &mdash; the toolbar scans the reactor for available **Spring Boot
  profiles** and **Maven profiles** and offers each as an editable dropdown.
- **Live JVM metrics** &mdash; once the app is up, the panel shows heap / non-heap,
  threads, health, profiles and startup info, sourced from the richest endpoint
  available (BootUI → Actuator → process).
- **Fix with Copilot** &mdash; on a compile error, failing tests, or a startup
  crash, a button pushes a context-rich request back into the chat so the agent
  can diagnose and fix it.
- **Keep the JVM warm** &mdash; optionally use the [Maven Daemon (`mvnd`)](https://github.com/apache/maven-mvnd)
  for Build / Test / Package so repeat runs skip JVM startup and JIT warmup.
- **Advisor scans (with BootUI)** &mdash; when the running app exposes
  [BootUI](https://github.com/jdubois/boot-ui), a toggle enables its MCP server and
  the advisor scans (architecture, Spring, security, Hibernate, …); findings can be
  sent to the agent with one click.

## Graceful degradation by capability

The console adapts to whatever the project provides, detected from the reactor
poms (static) and confirmed against the running app (runtime):

| Tier                    | Detected from              | What the console offers                                                                                                    |
| ----------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Java + Maven** (base) | always                     | Build, Test (graphical Surefire report), Package                                                                           |
| **Spring Boot**         | `spring-boot-maven-plugin` | Run via `spring-boot:run` + editable Spring profiles. (No Spring Boot ⇒ Run packages the module and launches `java -jar`.) |
| **Actuator** (runtime)  | `/actuator/*` answers      | Live metrics normalized from Actuator (heap, threads, health, uptime)                                                      |
| **BootUI** (runtime)    | `/bootui/api/*` answers    | Rich BootUI metrics **and** the MCP advisor-scan panel                                                                     |

A capability summary is shown in the status bar, and the metrics panel carries a
small badge (`BootUI` / `Actuator` / `process`) indicating which source is live.

## Requirements

- The [GitHub Copilot app](https://docs.github.com/en/copilot) or Copilot CLI with
  canvas-extension support.
- A target project built with **Maven** (the committed `./mvnw` wrapper is used when
  present, otherwise a system `mvn` on `PATH`) on **Java 17+**.
- Optional: [`mvnd`](https://github.com/apache/maven-mvnd) for warm builds, and
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

## Use

In a Copilot app session on a Maven project, open the **Coffilot** canvas, then:

1. **Build** to install modules (first run), or **Run** to start an app (pick a
   module and Spring profiles).
2. Watch the console stream the Maven / app output.
3. Once the app is up, watch the **Live JVM metrics** panel populate (badge:
   `BootUI` / `Actuator` / `process`).
4. If something fails, click **Fix with Copilot** to hand the error to the agent.
5. **Stop** when done.

The agent can drive the same flow with the `build_app`, `run_tests`,
`package_app`, `start_app`, `stop_app`, `get_status`, `get_metrics`, `fix_issue`
and `run_scan` actions.

## How it works

Coffilot is a Node process (the extension) that:

- shells out to `./mvnw` (the Maven wrapper, or a system `mvn` when no wrapper is
  present — or `mvnd`) for Build / Test / Package / Run and streams the output into
  the canvas over Server-Sent Events;
- parses the Surefire XML reports into a graphical test view;
- once an app is up, polls it for live metrics from the richest source available,
  proxying [BootUI](https://github.com/jdubois/boot-ui)'s sanitized `/bootui/api/**`
  DTOs when present and falling back to Actuator, then to coarse process metrics;
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
