---
home: true
heroText: Coffilot
tagline: Brew, taste and ship your Java app without leaving Copilot.
actions:
  - text: Explore features
    link: /features
    type: primary
  - text: Get started
    link: /getting-started
    type: secondary
features:
  - title: Build
    details: Run Maven or Gradle builds (auto-detected per project) straight from the side panel, streamed live, with an optional clean-first toggle.
  - title: Test
    details: Run the suite and read a graphical JUnit report — summary chips, per-suite grouping, and expandable failure stack traces — with a live progress bar.
  - title: Run affected
    details: Run only the tests touched by your uncommitted changes, selected from a dependency graph built from the compiled .class files.
  - title: Package
    details: Package the artifact like Build — streamed live — with optional clean-first and install-to-local-repository toggles.
  - title: Run & Debug with JDWP
    details: Launch Spring Boot, Quarkus dev mode or a plain-Java app, then attach a self-contained JDWP debugger for breakpoints, stepping, stacks and variables.
  - title: Fix with Copilot
    details: On a compile error, failing tests or a crash, push a context-rich request back into the chat — alongside live JVM metrics, loggers and advisor scans.
footer: Apache-2.0 Licensed | Coffilot
---

<ScreenshotCarousel />

## Start here

| Goal                                            | Documentation                     |
| ----------------------------------------------- | --------------------------------- |
| Install the extension and open the console      | [Get started](GETTING-STARTED.md) |
| Explore every lane and panel                    | [Features](FEATURES.md)           |
| See how Coffilot fits with BootUI and Dr JSkill | [Ecosystem](WORKS-WITH.md)        |
| Set up a development environment and contribute | [Contributing](CONTRIBUTING.md)   |
| Understand the loopback-only safety model       | [Security](SECURITY.md)           |

## How Coffilot works

Coffilot is a [GitHub Copilot canvas extension](https://docs.github.com/en/copilot/how-tos/github-copilot-app/working-with-canvas-extensions):
a single Node process that serves an iframe UI from a loopback HTTP server and shells out to the
project's build tool — Maven (`pom.xml` / `./mvnw`) when present, otherwise Gradle
(`build.gradle[.kts]` / `./gradlew`). Build, Test and Package share one lane while Run is
independent, so you can keep the app running while you re-test.

The console adapts to whatever the project provides. A plain Java module gets Build / Test /
Package; Spring Boot and Quarkus add a Run lane (`spring-boot:run` / `bootRun`, `quarkus:dev` /
`quarkusDev`); and live JVM metrics come from the richest endpoint available — **BootUI →
Actuator → Quarkus Micrometer/health → process**. Everything stays loopback-only: the server
binds to `127.0.0.1`, and the `/api/fix` and `/api/scan` endpoints only fire when you ask them to.

## The BootUI family

Coffilot is one of three projects that share a workflow — and a "circle of color":
**green = [BootUI](https://www.julien-dubois.com/boot-ui/)**,
**blue = Coffilot**, **terracotta = [Dr JSkill](https://www.julien-dubois.com/dr-jskill/)**.

1. **Dr JSkill** generates a Spring Boot application.
2. Add the **BootUI** starter for an in-app developer console exposed over `/bootui/`.
3. Drive build, run, test and debug from the Copilot side panel with **Coffilot** — which lights
   up its richest metrics and advisor-scan tier when the running app exposes BootUI.

See [the ecosystem](WORKS-WITH.md) for how the three fit together.
