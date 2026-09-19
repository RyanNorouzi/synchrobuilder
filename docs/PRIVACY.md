# Privacy: exactly what leaves your machine

Synchrobuilder has no server. The only place data goes is the git remote
your repository already uses, and only when the multiplayer features are in
use (a repository with a remote and a running background worker). The
portability features (audit, fix, guard, init, setup, doctor, ci) never send
anything anywhere.

## What is pushed to the remote

Each developer publishes one small set of files under their own ref
(`refs/synchrobuilder/v1/<handle>/<device>`; see
`adr/ADR-001-transport.md`). The files and their fields:

| File | Fields | Limits |
| :-- | :-- | :-- |
| `manifest.json` | handle, device id, schema version | handle matches `^[a-z0-9][a-z0-9-]{0,31}$`; device is 8 random hex characters |
| `presence.json` | handle, device, branch name, task summary, area (a repo-relative directory), last-seen time, session start time, plugin version | task summary 140 characters |
| `claims.json` | claimed repo-relative paths or task ids, time, note | 50 claims; note 140 characters |
| `board.json` | task id, title, status, owner handle, dependency ids | 50 tasks; title 100 characters |
| `contracts.json` | repo-relative paths of changed contract files and exported symbol names | 20 entries, 20 symbols each |
| `messages/<id>.json` | from, to, time, text | 400 characters, 6 lines |
| `handoffs/<id>.json` | from, time, branch, task, done, files changed, interfaces changed, decisions, blockers, next steps, for | list caps per field (see `adr/ADR-005-teammate-message-security.md`) |

Every free-text field passes secret redaction before it is written to the
journal, and again before it is published: private keys, GitHub, Anthropic,
OpenAI, AWS, Slack and Stripe token shapes, high-entropy strings next to
key-like words, and credentials embedded in URLs are replaced with
`[redacted]`.

The commit that carries these files is authored as
`<handle>@synchrobuilder.invalid` and its message starts with `[skip ci]`.
Your real email is not used unless your team opts in for a git host that
enforces author rules (`.synchrobuilder/team.json`, `transport.realEmail`).

## What never leaves your machine

- Your prompts, Claude's replies, transcripts, or any part of a conversation.
- File contents, diffs, or code. The guard, audit and fix features read your
  files locally and report locally.
- Environment variable values. The manifest and doctor deal in names only.
- Your email address (see the opt-in above), your machine name, or your
  username. The device id is random.
- Anything from repositories you did not run the multiplayer features in.

## What stays local, and where

Set `SYNCHROBUILDER_NO_WORKER=1` to stop the background sync from starting at all. The
portability features keep working; nothing is published and nothing is fetched.

`~/.synchrobuilder/` (or `SYNCHROBUILDER_HOME`) holds: the hidden bare git
repository per remote, the local snapshot of teammates' state, your own
journal of events (edited paths, claims, messages you sent), session
records, logs, and the handoff draft. `npx synchrobuilder clean` removes it.
Nothing is written inside your repository or its `.git`.

Logs contain error messages and timings. They never contain prompts or file
contents.

## Who can see what you publish

Anyone who can fetch the repository can read the files above, including the
public if the repository is public. `synchrobuilder doctor` warns when the
remote's state refs are readable without credentials.

## Website

The website sets no cookies, loads no third-party scripts or fonts, and
records nothing.
