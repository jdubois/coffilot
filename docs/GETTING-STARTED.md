# Get started

Coffilot is a GitHub Copilot **canvas extension**: it lives in a `.github/extensions/coffilot/`
folder (committed to a repo, shared with the team) or in `$COPILOT_HOME/extensions/coffilot/`
(`~/.copilot/extensions/coffilot/`, just for you).

## Requirements

- The [GitHub Copilot app](https://docs.github.com/en/copilot) or Copilot CLI with
  canvas-extension support.
- **Node.js 20+** — the runtime the Copilot CLI uses to launch the extension.
- A target project built with **Maven** or **Gradle** on **Java 17+**. The committed wrapper
  (`./mvnw` or `./gradlew`) is used when present, otherwise a system `mvn` / `gradle` on `PATH`.
  Works on macOS, Linux and Windows. If both build tools are present, Maven is used.
- Optional: [`mvnd`](https://github.com/apache/maven-mvnd) for warm Maven builds (the Gradle daemon
  serves the same role and is always available), and
  [BootUI](https://github.com/jdubois/boot-ui) on the target app for the richest metrics and
  advisor scans.

## Install

### From the Copilot app

Use **Install extension from repo…** (or the `install_extension` action) and point it at this
repository:

```
https://github.com/jdubois/coffilot
```

Choose **project** scope to commit it into the current repo's `.github/extensions/`, or **user**
scope to install it just for you.

### Manually

Copy the extension files into the target location, keeping the folder name `coffilot`:

```bash
# Project scope (committed to the repo you want to drive):
mkdir -p .github/extensions/coffilot
cp -R extension.mjs copilot-extension.json public .github/extensions/coffilot/

# Or user scope (available in every session):
mkdir -p ~/.copilot/extensions/coffilot
cp -R extension.mjs copilot-extension.json public ~/.copilot/extensions/coffilot/
```

Reload extensions (or restart the session); Coffilot is then discovered automatically
(`canvasId: java-app`).

## Use

In a Copilot app session on a Maven or Gradle project, open the **Coffilot** canvas, then:

1. **Build** to compile the project (first run), or **Run** to start an app (pick a module and a
   run profile).
2. Watch the console stream the build-tool / app output.
3. Once the app is up, watch the **Live JVM metrics** panel populate (badge:
   `BootUI` / `Actuator` / `Quarkus` / `process`).
4. If something fails, click **Fix with Copilot** to hand the error to the agent.
5. Or **Debug** instead of Run to launch under the debugger: open the **Debug** tab, add a
   breakpoint (class binary name + line), and use Continue / Step / Pause; the paused call stack,
   frame variables and an evaluator appear inline.
6. **Stop** when done.

## Drive it from the agent

The agent can drive the same flow with the `build_app`, `run_tests`, `run_affected_tests`,
`package_app`, `start_app`, `stop_app`, `get_status`, `get_metrics`, `profile_app`, `fix_issue`,
`run_scan`, `check_dependencies` and `set_log_level` actions, plus the debug actions
`start_debug`, `stop_debug`, `set_breakpoint`, `remove_breakpoint`, `debug_continue`, `debug_step`,
`debug_stack`, `get_variables`, `debug_evaluate` and `debug_status`.

## Next steps

- Read the full [Features](FEATURES.md) tour.
- See how Coffilot pairs with BootUI and Dr JSkill in the [Ecosystem](WORKS-WITH.md) page.
- Review the loopback-only [Security](SECURITY.md) model before pointing it at a project.
