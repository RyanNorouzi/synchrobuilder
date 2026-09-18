# synchrobuilder.json, version 1

The manifest describes what a project needs in order to run, so that a teammate on a
different operating system can get from `git clone` to a passing health check without
asking anyone. It is a plain JSON file at the repository root. Nothing in it mentions
Claude or Synchrobuilder, and any tool is welcome to read or write it.

This is the normative specification for version 1. The design rationale is in
`adr/ADR-004-manifest-format.md`.

## Rules

1. **JSON only**, UTF-8, LF line endings, two-space indent when a tool writes it. No
   comments: explanations live in `hint` and `description` fields, which tools show to
   people.
2. **`version` is an integer.** A reader that meets a higher major version stops with a
   clear message. Adding a field does not bump it; removing one or changing what a
   field means does.
3. **Runtime versions are exact.** `"20.11.0"`, never `">=20"`. "Works on my machine"
   usually is a version range.
4. **Environment variables are names and descriptions only.** A `value` key is invalid
   and a writer must refuse to emit one.
5. **Commands carry no shell syntax.** `&&`, `||`, `|`, `;`, `>`, `<`, backticks, `$VAR`
   and `${VAR}` are rejected. A runner tokenizes the string (quotes and backslash
   escapes only) and spawns the program directly. A pipeline belongs in a script that
   the command then calls.
6. **Per-OS overrides are limited** to `commands` and `runtimes`, under
   `os.windows`, `os.macos` or `os.linux`. Nothing else varies by platform.
7. **Extensions start with `x-`.** Any other unknown key is an error, so a typo is
   caught rather than ignored.

## Example

```json
{
  "$schema": "https://synchrobuilder.dev/schema/manifest-v1.json",
  "version": 1,
  "name": "acme-portal",
  "runtimes": [
    { "name": "node", "version": "20.11.0", "detect": "node --version" }
  ],
  "packageManager": { "name": "pnpm", "version": "9.1.0" },
  "services": [
    { "name": "postgres", "version": "16", "port": 5432, "hint": "Any Postgres 16 reachable at DATABASE_URL" }
  ],
  "env": [
    { "name": "DATABASE_URL", "description": "Postgres connection string", "required": true },
    { "name": "DEBUG", "description": "Verbose logging", "required": false }
  ],
  "commands": {
    "install": "pnpm install --frozen-lockfile",
    "build": "pnpm build",
    "migrate": "pnpm prisma migrate deploy",
    "seed": "pnpm run seed",
    "start": "pnpm dev",
    "test": "pnpm test"
  },
  "healthCheck": {
    "type": "http",
    "url": "http://localhost:3000/health",
    "expectStatus": 200,
    "timeoutSeconds": 60
  },
  "os": {
    "windows": { "commands": { "start": "pnpm dev:win" } }
  }
}
```

## Fields

| Field | Required | Type | Meaning |
| :-- | :-- | :-- | :-- |
| `$schema` | no | string | URL of the JSON schema. Informational. |
| `version` | yes | integer | `1`. |
| `name` | no | string | Human name of the project. |
| `runtimes` | no | array | Language runtimes the project needs. |
| `runtimes[].name` | yes | string | `node`, `python`, `ruby`, `go`, `java`, `dotnet`, `php`, `rust`. |
| `runtimes[].version` | yes | string | Exact version, no range. |
| `runtimes[].detect` | no | string | Command that prints the installed version. Defaults to `<name> --version`. |
| `packageManager` | no | object | `{ name, version }`, for example `{ "name": "pnpm", "version": "9.1.0" }`. |
| `services` | no | array | Databases and other processes the project talks to. |
| `services[].name` | yes | string | `postgres`, `redis`, `mysql`, `mongodb`, or your own name. |
| `services[].version` | no | string | Major version is usually enough. |
| `services[].port` | no | integer | Used by `doctor` to see whether it answers. |
| `services[].hint` | no | string | One sentence a human reads when it is missing. |
| `env` | no | array | Environment variables the project reads. |
| `env[].name` | yes | string | The variable's name. A `value` key is invalid. |
| `env[].description` | no | string | What it is for. |
| `env[].required` | no | boolean | Default `true`. |
| `commands` | no | object | `install`, `build`, `migrate`, `seed`, `start`, `test`. Each a string with no shell syntax. |
| `healthCheck` | no | object | How to know the app is actually up. |
| `healthCheck.type` | yes | string | `http` or `command`. |
| `healthCheck.url` | for http | string | URL to GET. |
| `healthCheck.expectStatus` | no | integer | Default `200`. |
| `healthCheck.command` | for command | string | Program to run; exit 0 means healthy. |
| `healthCheck.timeoutSeconds` | no | integer | Default `60`. |
| `os.<windows\|macos\|linux>` | no | object | `commands` and `runtimes` overrides for that OS. |
| `x-*` | no | any | Your own extensions. |

## How Synchrobuilder uses it

- `synchrobuilder init` detects and writes it, and lists everything it guessed.
- `synchrobuilder setup` builds a per-OS plan from it, asks before each install, and
  finishes with the health check.
- `synchrobuilder doctor` compares this machine against it and orders the differences
  by how likely each is to be the actual problem.
- `synchrobuilder ci` turns it into a GitHub Actions workflow that runs on ubuntu,
  macos and windows.

## Running commands without a shell on Windows

`npm`, `pnpm` and `yarn` are `.cmd` shims on Windows and cannot be spawned directly.
A runner resolves them to their JavaScript entry point and runs that with `node`
(`npm-cli.js`, or the Corepack shim for pnpm and yarn). When resolution fails, the
runner prints the command for the user to run rather than silently falling back to a
shell. This is unverified on a real Windows machine so far; it is covered by the
Windows CI job.

## Versioning

Additive changes keep `version: 1`. A removal or a change in meaning becomes
`version: 2`, and readers reject a manifest whose major version they do not know.
