# Contributing to Coffilot

Thanks for your interest in improving Coffilot! This document explains how to get
a working development setup and submit changes.

## Code of conduct

This project adheres to the [Contributor Covenant](CODE_OF_CONDUCT.md). By
participating you are expected to uphold this code.

## What Coffilot is

Coffilot is a [GitHub Copilot canvas extension](https://docs.github.com/en/copilot/how-tos/github-copilot-app/working-with-canvas-extensions):
a single Node process (`extension.mjs`) that speaks JSON-RPC to the Copilot CLI
over stdio, serves an iframe UI (`public/index.html`) from a loopback HTTP server,
and shells out to the project's build tool (Maven or Gradle) to build / test /
package / run the target Java project.

## Prerequisites

- **Node.js 20+** (the runtime the Copilot CLI uses to launch the extension).
- The **GitHub Copilot app** or Copilot CLI with canvas-extension support.
- A **Maven** or **Gradle** Java / Spring Boot / Quarkus project to test against.
  [BootUI](https://github.com/jdubois/boot-ui)'s `bootui-sample-app` is a convenient
  target because it lights up every metrics tier.

## Repository layout

```
extension.mjs            The extension: SDK wiring, canvas + actions, loopback HTTP
                         server, Maven/Gradle runner, JUnit report parser, metrics/MCP
                         proxy, the Debug lane (JDWP injection + attach), and the
                         "fix with Copilot" bridge.
jdwp.mjs                 The self-contained JDWP debug engine: a loopback JDWP client
                         and a DebugSession (breakpoints, stepping, stack, locals,
                         evaluate, snapshots). Pure (takes a log callback); no external
                         DAP server or language server. Drives the Debug lane.
public/index.html        The iframe UI markup (toolbar, Build/Test/Package/Run/Debug
                         tabs, live console, graphical test results, metrics + MCP
                         panels); links public/styles.css and public/app.js.
public/styles.css        The iframe styles, using the canvas theme tokens. Served
                         unauthenticated (no secrets) so the iframe can load it.
public/app.js            The iframe client logic. Served unauthenticated (no secrets);
                         it reads the instance/token from its URL to call /api/*.
public/favicon.svg       The canvas icon the host shows for the extension (the host
                         probes the extension directory for public/favicon.svg).
copilot-extension.json   Manifest ({ "name": "coffilot", "version": 1 }) used by the
                         share / install flow.
```

## Develop and test

The extension is discovered from `.github/extensions/<name>/` (relative to a git
root) or `$COPILOT_HOME/extensions/<name>/`.

This repo ships a `.github/extensions/coffilot/extension.mjs` wrapper that loads
the root `extension.mjs`, so **opening this repository** in the Copilot app loads
Coffilot automatically — handy for verifying it boots. (If you also keep a
`~/.copilot/extensions/coffilot` symlink, remove it while working here so Coffilot
isn't loaded twice.)

Coffilot drives a _separate_ Maven or Gradle project, so to exercise it against a
real build, develop against a checkout of a Java app:

1. Symlink or copy this repo into the target project's extensions folder:

   ```bash
   # from your Java project's root
   mkdir -p .github/extensions
   ln -s /path/to/coffilot .github/extensions/coffilot
   ```

   (A symlink lets you edit Coffilot in place and just reload.)

2. Open a Copilot session on that project, reload extensions, and open the
   **Coffilot** canvas.
3. After every change to `extension.mjs`, `public/index.html`, `public/styles.css`,
   or `public/app.js`, **reload extensions** and re-open the canvas so the new code
   and iframe are picked up.

### Debugging

`stdout` is reserved for JSON-RPC, so **never `console.log` in `extension.mjs`** —
it corrupts the protocol. Use `session.log(message, { level, ephemeral })` for
anything user-visible, and inspect the extension log via the CLI's extension
inspect tooling when something fails to load.

## Validate

Before opening a pull request:

```bash
npm install          # first time only, to get Prettier + jsdom
npm run check        # node --check extension.mjs (syntax)
npm test             # node:test unit + UI smoke tests
npm run format:check # Prettier formatting
```

Run `npm run format` to apply formatting. The whole repo is Prettier-formatted
(`prettier.config.cjs`); CI fails if `format:check` does.

### Testing

Tests live under `test/` and run on Node's built-in test runner (`node --test`,
no extra framework) via `npm test`. The `test` script lists the test files
explicitly (rather than relying on directory discovery) so a local
`integration-tests/**` build tree can never be mistaken for a test file — add new
test files to that list. CI runs the same command.

- **`test/parsers.test.mjs`** exercises the pure parsers / normalizers exported
  from `extension.mjs` — the JUnit/Surefire XML parser, the `.class`
  constant-pool reference reader and affected-test graph walk, and the
  Prometheus / Quarkus metrics normalizers. To make `extension.mjs` importable
  outside the Copilot CLI, the test sets `COFFILOT_TEST=1`, which makes the
  module skip its side-effectful bootstrap (joining a session, declaring the
  canvas, starting the loopback server) and dynamically import the
  CLI-injected `@github/copilot-sdk`. Add new pure helpers behind an `export`
  and cover them here.
- **`test/ui-smoke.test.mjs`** loads `public/index.html` into
  [jsdom](https://github.com/jsdom/jsdom), executes `public/app.js` against it
  with stubbed network globals (`EventSource` / `fetch` / `matchMedia`), and
  calls the key render globals (`renderMetrics`, `renderMcp`, `renderStatus`,
  `renderTests`) on representative payloads to catch parse errors and obvious
  render regressions. Manual verification in a live canvas is still expected for
  UI changes.
- **`test/integration-projects.test.mjs`** drives Coffilot's real
  project-classification logic (build-tool detection, capability/tier
  classification, run-mode inference, project-root resolution) against the actual
  build files of every project under `integration-tests/`, asserting the tier each
  scenario is meant to exercise. It also asserts Coffilot's lane command builders
  (`buildArgsFor` / `testArgsFor` / `packageArgsFor` / `affectedTestArgsFor`) for
  both Maven and Gradle, so the documented per-lane command vectors can't silently
  drift. Deterministic — no JDK or network — so it runs as part of `npm test`.
- **`test/e2e-projects.test.mjs`** is the realistic pass: it actually builds,
  tests and packages each `integration-tests/` project with its own wrapper —
  using Coffilot's own lane commands (`testArgsFor` / `buildArgsFor` /
  `packageArgsFor`) rather than a hand-maintained copy — then feeds the JUnit
  reports the build produced through Coffilot's own report discovery + parser
  (`collectSurefireReport`) and asserts the parsed results. The `failing-tests`
  project covers the failure path (build exits non-zero, report still parses with
  the right pass/fail/error split), and two projects additionally assert the Build
  and Package lanes each produce a jar. It needs a JDK 17 and network access, so it
  is **skipped unless `COFFILOT_E2E=1`**:

  ```bash
  COFFILOT_E2E=1 npm test                     # all projects
  COFFILOT_E2E=1 node --test \
    --test-name-pattern '^hello-world:' \
    test/e2e-projects.test.mjs                # one project
  ```

CI runs the end-to-end tests per project in a dedicated `E2E (<project>)` matrix
job (JDK 17 + `COFFILOT_E2E=1`), so the tiers Coffilot drives stay green against
real Maven and Gradle builds.

## Safety notes when testing

The loopback control endpoints are mostly safe to `curl` for inspection
(`/api/state`, `/api/settings`, `/api/recheck`, `/api/build`, `/api/test`, `/api/run`, `/api/stop`, `/api/restart`,
`/api/scans`, `/events`, …), but **`/api/fix` fires a prompt into the conversation**
(and `/api/scan` triggers an advisor scan on the running app) — don't call them
casually. The HTTP server binds to `127.0.0.1`
only; keep it that way.

Coffilot persists a little per-project state under
`$COPILOT_HOME/extensions/coffilot/artifacts/` (keyed by a hash of the project
path): `settings-<hash>.json` (the Settings panel), `lasttest-<hash>.json` (the
last full-suite test total for the progress bar), and `history-<hash>.json`
(recent Build/Test/Package/Run results, restored on reload). These are safe to
delete to reset that state.

## Submitting a change

1. Open or claim an issue describing the change before you write code.
2. Create a topic branch off `main`. Branch names should start with your GitHub
   username (e.g. `jdubois/improve-test-view`).
3. Keep PRs small and focused. Update [README.md](README.md) and [PLAN.md](PLAN.md)
   when behaviour changes.
4. Run `npm run check` and `npm run format:check` before pushing.
5. Use the pull request template.

## Reporting bugs and security issues

- **Bugs**: open an issue using the _Bug report_ template.
- **Security vulnerabilities**: do **not** open a public issue. Use GitHub's
  private vulnerability reporting — see [SECURITY.md](SECURITY.md).

## License

By contributing you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE).
