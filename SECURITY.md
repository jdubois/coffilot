# Security Policy

## Supported versions

The latest released line of Coffilot receives fixes. Coffilot is pre-1.0, so only
the most recent tag is supported.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Use GitHub's private vulnerability reporting on this repository:

1. Go to the **Security** tab.
2. Click **Report a vulnerability**.
3. Describe the issue, the affected version, and a reproduction.

You will receive an acknowledgement within five working days.

## Threat model and intended use

Coffilot is a **local developer tool**: a GitHub Copilot canvas extension that runs
as a Node process on the developer's machine and drives Maven or Gradle builds of
the project being worked on. By design it:

- binds its iframe / control HTTP server to the **loopback interface only**
  (`127.0.0.1`); the Copilot app only embeds loopback URLs;
- executes the project's own committed build wrapper (`./mvnw` or `./gradlew`) and,
  when running a plain-Java module, the JAR produced by that build — it does not
  download or run arbitrary third-party binaries beyond what Maven or Gradle itself
  resolves;
- exposes mutating actions (Build / Test / Package / Run / Stop, the BootUI MCP
  toggle, and "Fix with Copilot") explicitly from the UI or agent actions, never
  implicitly on load.

### Known limitations

- **Best-effort secret masking.** Build-tool and application stdout are passed
  through a conservative masker before they are streamed to the iframe or included
  in "Fix with Copilot" context, redacting common token shapes (provider keys,
  bearer tokens, JWTs, credentials in URLs, and `key=value` secret assignments).
  This is heuristic, not exhaustive — unusual secret formats can still slip through.
  Masking is on by default and can be disabled with the `maskSecrets` setting for a
  trusted local build.
- Coffilot trusts the Maven or Gradle project it is pointed at. Only use it on
  projects you trust, exactly as you would before running `./mvnw` or `./gradlew`
  yourself.

### Operator responsibilities

- Run Coffilot only against trusted local checkouts.
- Do not expose the loopback control endpoints to other hosts.
- Treat the `/api/fix` and `/api/mcp/scan` endpoints as privileged — they send
  prompts / scans into the active Copilot conversation.

## License

This project is licensed under the [Apache License 2.0](LICENSE).
