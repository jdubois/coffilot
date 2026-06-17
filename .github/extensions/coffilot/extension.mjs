// Project-scoped entry point for the Coffilot canvas extension.
//
// The Copilot CLI auto-discovers extensions in `.github/extensions/<name>/`, so
// keeping this file here makes Coffilot load by default whenever this repository
// is opened in the Copilot app — no manual install step is required.
//
// The real implementation lives at the repository root (`../../../extension.mjs`)
// to keep a single source of truth alongside its `public/` assets and
// `package.json`. This thin wrapper only imports that module for its side effects
// (the root module calls `joinSession(...)` at load time). Because every ES module
// keeps its own `import.meta.url`, the root module still resolves `public/`
// relative to the repo root even when it is loaded through this wrapper.
import "../../../extension.mjs";
