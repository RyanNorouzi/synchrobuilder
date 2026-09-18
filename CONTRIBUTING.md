# Contributing

Thanks for helping. A few rules keep this project trustworthy:

- **Node only.** Everything that ships is plain JavaScript ESM (`.mjs`)
  invoked as `node <path>`. No bash, PowerShell or cmd anywhere in
  `plugins/`. No runtime dependencies; ask in an issue before adding a dev
  dependency.
- **Fail open.** Hooks exit 0 with no output on any internal error and log to
  `~/.synchrobuilder/logs/`. They read local files only and must stay fast.
- **Windows is a first-class target.** Use `path.join`, `os.homedir()`,
  handle backslashes and case-insensitive file systems, and keep paths short.
  A red Windows CI job blocks a release.
- **No fake evidence.** Do not claim something works, in code comments, docs
  or the website, unless a test in this repository proves it.
- **Files under 500 lines.** Split modules instead.
- **Teammate text is untrusted input.** Anything that crosses machines goes
  through the validators in `lib/core/schema.mjs` and the sanitizer.

## Auditing this repository

Synchrobuilder audits itself: `node plugins/synchrobuilder/bin/synchrobuilder.mjs audit`
must report a score of 100 for the code we ship. `.synchrobuilder/config.json` ignores
four kinds of path, all of which legitimately contain the very patterns the rules look
for: `examples/demo-repo/**` (planted bugs), `tests/**` (fixtures with Windows paths,
home directories and hostile strings), `docs/research/**` (quoted documentation) and
the rule and fixer sources themselves.

## Workflow

```
node scripts/lint.mjs
node scripts/test.mjs
node plugins/synchrobuilder/bin/synchrobuilder.mjs audit --strict
```

Small, focused commits with clear messages. Update `CHANGELOG.md` with every
user-visible change. Decisions that change the architecture go through an
ADR in `docs/adr/`.
