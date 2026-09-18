# ADR-004: The `synchrobuilder.json` project manifest

- Status: Proposed (awaiting approval at the end of Phase 0)
- Date: 2026-09-18
- Deciders: lead engineer, project owner

## Context

`/synchrobuilder:init` writes a manifest describing what a project needs to
run; `/synchrobuilder:setup` and `/synchrobuilder:doctor` read it on another
machine; `/synchrobuilder:ci` turns it into a GitHub Actions matrix. The
brief requires the format to be simple, versioned, documented, and not tied
to Claude so other coding agents can adopt it. The plugin has no runtime
dependencies, so the format must be parseable with the Node standard library.

## Decision

1. **Format: JSON**, one file, `synchrobuilder.json` at the repository root,
   UTF-8, LF, two-space indent when we write it. JSON is the only structured
   format Node can parse without a dependency, every editor validates it, and
   it round-trips through `JSON.parse`/`JSON.stringify` without comments to
   lose.
2. **Versioned by an integer** top-level `"version": 1`. Readers reject a
   higher major version with a clear message and accept lower ones with
   defaults. Additive changes do not bump the version; removals and semantic
   changes do.
3. **Shape (v1)** — the normative spec lives in `docs/manifest-spec.md`
   (Phase 4); this is the agreed skeleton:

   ```json
   {
     "$schema": "https://synchrobuilder.dev/schema/manifest-v1.json",
     "version": 1,
     "name": "acme-portal",
     "runtimes": [
       { "name": "node", "version": "24.16.0", "detect": "node --version" }
     ],
     "packageManager": { "name": "pnpm", "version": "10.22.0" },
     "services": [
       { "name": "postgres", "version": "16", "port": 5432,
         "hint": "Any Postgres 16 reachable at DATABASE_URL" }
     ],
     "env": [
       { "name": "DATABASE_URL", "description": "Postgres connection string", "required": true },
       { "name": "SESSION_SECRET", "description": "Random 32+ character string", "required": true }
     ],
     "commands": {
       "install": "pnpm install --frozen-lockfile",
       "migrate": "pnpm prisma migrate deploy",
       "seed": "pnpm run seed",
       "start": "pnpm run dev",
       "test": "pnpm test"
     },
     "healthCheck": {
       "type": "http",
       "url": "http://localhost:3000/health",
       "timeoutSeconds": 60,
       "expectStatus": 200
     },
     "os": {
       "windows": { "commands": { "start": "pnpm run dev:win" } }
     }
   }
   ```

   - `runtimes[].version` is an **exact** version string. `setup` installs or
     verifies exactly that version; `doctor` reports the difference. Ranges
     are not allowed in v1 because "works on my machine" is the bug we are
     removing.
   - `env[]` holds **names and descriptions only**. A value field is not part
     of the schema and the writer refuses to serialize one.
   - `commands.*` are **plain argument strings without shell syntax**. The
     runner splits them with a small, documented tokenizer (quotes and
     backslash escapes only) and spawns the program directly. `&&`, `|`,
     `$VAR`, `>` are rejected with a message pointing at the audit rule that
     explains why. A project that truly needs a shell pipeline puts it in a
     Node script and calls that.
   - `os.<windows|macos|linux>` may override `commands` and `runtimes` only.
     Nothing else is per-OS, on purpose.
   - Unknown top-level keys are allowed only with an `x-` prefix, which keeps
     the door open for other tools without silently accepting typos.
   - `healthCheck.type` is `http` (GET a URL, expect a status) or `command`
     (spawn a program, expect exit 0). Both have a timeout.
4. **Neutral naming.** Nothing in the file mentions Claude, hooks or the
   plugin. The `$schema` URL is served from the website (Phase 7) so other
   tools can validate against it.

## Consequences

- Running `npm`, `pnpm` and `yarn` on Windows without a shell needs care:
  their `.cmd` shims cannot be spawned directly. The runner resolves the
  package manager to its JavaScript entry point (for npm,
  `<node prefix>/node_modules/npm/bin/npm-cli.js`; for Corepack-managed
  pnpm/yarn, the Corepack shim's JavaScript entry) and runs it with `node`.
  This is the same technique the Claude Code docs recommend for exec-form
  hooks on Windows (see `docs/research/hooks-core.md`). If resolution fails,
  `setup` says so and offers to open a shell command for the user to run
  themselves rather than running a shell silently.
- Exact versions mean the manifest changes whenever the team upgrades Node;
  `/synchrobuilder:init --refresh` re-detects and shows a diff.
- No comments in the file. Explanations go in `hint` and `description`
  fields, which the tooling shows to humans.
- Because the schema forbids values for env vars, the audit rule "secret in
  manifest" is structurally unnecessary, but redaction still runs on `hint`
  and `description` text before anything is shared (ADR-005).

## Alternatives considered

- **YAML or TOML.** More pleasant to hand-edit, but both need a parser
  dependency and YAML's implicit typing (`version: 16` becoming a number,
  `on:` becoming `true`) is a documented source of portability bugs.
- **`devcontainer.json`.** Good for containers, but it assumes Docker and
  does not describe native installs, health checks or per-OS commands. We
  will document how to derive a devcontainer from the manifest later.
- **`package.json` `engines` plus scripts.** Node-only and cannot express
  services or env var descriptions.
- **Semver ranges for runtimes.** Rejected for v1 (see above); could be added
  as `allowedRange` in v2 without a version bump.

## Evidence and verification

- The JSON parse path needs no dependency (Node standard library).
- The Windows `.cmd` shim limitation is stated in the Claude Code hooks
  reference (exec form section) and matches Node's own child_process
  behavior since the 2024 security fix that stopped spawning `.bat`/`.cmd`
  files without a shell. We have not yet run the package-manager entry-point
  resolution on a Windows machine; it is a Phase 4 acceptance test on the
  Windows CI runner.
