# Coffilot — Copilot instructions

Coffilot is a **GitHub Copilot canvas extension** (not a Java app). It turns a
Maven- or Gradle-based Java / Spring Boot / Quarkus project into an interactive console in the
Copilot app's side panel: Build / Test / Package / Run lanes, live JVM metrics, and a
"Fix with Copilot" bridge. Read `README.md`, `PLAN.md`, and `CONTRIBUTING.md`
before changing visible behavior.

## What this repo is

- A single Node process: `extension.mjs` (entry, **must** keep this name), serving
  `public/index.html` (which links `public/styles.css` + `public/app.js`) from a
  loopback HTTP server, plus the `copilot-extension.json` manifest. There is **no
  build step** and no framework — plain ESM + an HTML/CSS/JS iframe.
- `@github/copilot-sdk` is resolved by the Copilot CLI at runtime; do **not** add it
  to `package.json` or vendor `node_modules` for it. The only dev dependency is
  Prettier.

## Toolchain

- **Node.js 20+**. The only tooling is Prettier (`prettier.config.cjs`: 2-space,
  double quotes, semicolons, `printWidth: 120`).
- Validate with `npm run check` (`node --check extension.mjs`) and
  `npm run format:check`; apply formatting with `npm run format`. CI runs both via
  `.github/workflows/ci.yml`.

## Critical rules

- **Never `console.log` in `extension.mjs`.** `stdout` is the JSON-RPC channel and
  logging corrupts it. Use `session.log(msg, { level, ephemeral })`.
- **Bind servers to `127.0.0.1` only.** The host only embeds loopback URLs.
- The loopback control endpoint `/api/fix` **sends a prompt into the live
  conversation**, and `/api/scan` **runs a BootUI advisor scan on the running app** —
  never `curl` them casually while testing. Safe-to-inspect endpoints include
  `/api/state`, `/api/settings`, `/api/build`, `/api/test`, `/api/package`,
  `/api/run`, `/api/stop`, `/api/scans`, and `/events`.
- After editing `extension.mjs`, `public/index.html`, `public/styles.css`, or
  `public/app.js`, **reload extensions and re-open the canvas** (the iframe
  port/token rotate on reload).
- The whole repo is Prettier-formatted — run `npm run format` after edits instead of
  hand-formatting.

## Branding

The project identity is **Coffilot**. Keep references to **BootUI**, **Actuator**,
and **`mvnd`** only where they name a real integration/tier — BootUI is the richest
optional metrics + advisor-scan tier, not the project's identity. Maven and Gradle
are both first-class build tools, auto-detected per project.

## How it works (orientation)

- `extension.mjs`: `joinSession({ canvases: [makeCanvas()] })`, the canvas
  declaration + agent actions (`build_app`, `run_tests`, `run_affected_tests`,
  `package_app`, `start_app`, `stop_app`, `get_status`, `get_metrics`, `fix_issue`,
  `run_scan`), the build-tool
  runner (`spawn` of `./mvnw`/`mvnd` for Maven or `./gradlew`/`gradle` for Gradle,
  with `--enable-native-access=ALL-UNNAMED` via `MAVEN_OPTS` / `GRADLE_OPTS`), the run
  modes (`spring-boot:run`/`bootRun` for Spring Boot, `quarkus:dev`/`quarkusDev` for
  Quarkus, else the generic Java runner), the JUnit report parser (Maven Surefire /
  Gradle `build/test-results`), the metrics proxy (tiered BootUI → Actuator →
  Quarkus Micrometer/health → process), the BootUI advisor-scan REST client
  (`/bootui/api/panels` for discovery, `POST /bootui/api/{id}/scan` to run one), the
  MCP-server toggle/register bridge, and the fix-prompt builder.
- `public/index.html`: the iframe UI markup (Build/Test/Package/Run + Live JVM +
  Loggers + Scans + Settings tabs, live console, graphical test view, MCP-server
  bridge). Styles live in
  `public/styles.css` (canvas theme tokens, e.g. `var(--background-color-default, …)`)
  and client logic in `public/app.js`; both are served unauthenticated since they
  hold no secrets, while `/api/*` and `/events` stay token-gated.
- The build tool is auto-detected per project: Maven (`pom.xml` / `mvnw`) wins when
  present, otherwise Gradle (`build.gradle[.kts]` / `gradlew`). The project root is
  resolved from the session's primary working directory (the project the user opened,
  via the SDK permission-paths API), falling back to walking up from the extension
  folder / launch cwd to the directory that owns the build wrapper (`mvnw` or
  `gradlew`), so Coffilot works regardless of where it is installed (project-embedded
  or a user/global symlink).

## Scope

Maven and Gradle build tools (auto-detected per project), loopback only (no remote
access), and no mutation of the target project's source without an explicit agent
action.
