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
and shells out to Maven to build / test / package / run the target Java project.

## Prerequisites

- **Node.js 20+** (the runtime the Copilot CLI uses to launch the extension).
- The **GitHub Copilot app** or Copilot CLI with canvas-extension support.
- A **Maven** Java / Spring Boot project to test against. [BootUI](https://github.com/jdubois/boot-ui)'s
  `bootui-sample-app` is a convenient target because it lights up every metrics
  tier.

## Repository layout

```
extension.mjs            The extension: SDK wiring, canvas + actions, loopback HTTP
                         server, Maven runner, Surefire parser, metrics/MCP proxy,
                         and the "fix with Copilot" bridge.
public/index.html        The iframe UI markup (toolbar, Build/Test/Package/Run tabs,
                         live console, graphical test results, metrics + MCP panels);
                         links public/styles.css and public/app.js.
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
root) or `$COPILOT_HOME/extensions/<name>/`. Coffilot drives a _separate_ Maven
project, so develop against a checkout of a Java app:

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
npm install          # first time only, to get Prettier
npm run check        # node --check extension.mjs (syntax)
npm run format:check # Prettier formatting
```

Run `npm run format` to apply formatting. The whole repo is Prettier-formatted
(`prettier.config.cjs`); CI fails if `format:check` does.

For the iframe UI, a quick way to confirm the inline script still parses and the
key render functions work is to load `public/index.html` in [jsdom](https://github.com/jsdom/jsdom)
and call the globals (`renderMetrics`, `renderMcp`, `renderStatus`, …). Manual
verification in a live canvas is still expected for UI changes.

## Safety notes when testing

The loopback control endpoints are mostly safe to `curl` for inspection
(`/api/state`, `/api/settings`, `/api/build`, `/api/test`, `/api/run`, `/api/stop`,
`/events`, …), but **`/api/fix` and `/api/mcp/scan` fire prompts / scans into the
conversation** — don't call them casually. The HTTP server binds to `127.0.0.1`
only; keep it that way.

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
