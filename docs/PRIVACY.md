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
| `presence.json` | handle, device, branch name, task summary, area (a repo-relative directory), last-seen time, session start time, plugin version | task summary 140 characters; empty unless the team sets `presence.shareTask` (see below) |
| `claims.json` | claimed repo-relative paths or task ids, time, note | 50 claims; note 140 characters |
| `board.json` | task id, title, status, owner handle, dependency ids | 50 tasks; title 100 characters |
| `contracts.json` | repo-relative paths of changed contract files and exported symbol names | 20 entries, 20 symbols each |
| `messages/<id>.json` | from, to, time, text | 400 characters, 6 lines |
| `handoffs/<id>.json` | from, time, branch, task, done, files changed, interfaces changed, decisions, blockers, next steps, for | list caps per field (see `adr/ADR-005-teammate-message-security.md`) |

A file being edited is also held by a lease (`adr/ADR-007-leases.md`): one more
ref per held file, `refs/synchrobuilder/lease1/<hash>`, whose commit message
carries handle, device, seat, the repo-relative path, when it was taken and
when it expires. The ref name is a hash of the lower-cased path. Lease refs
are written only when a teammate on another machine has been seen, are never
written to a public repository that has not opted in, and are deleted when the
file is let go.

Every free-text field passes secret redaction before it is written to the
journal, and again before it is published: private keys, GitHub, Anthropic,
OpenAI, AWS, Slack and Stripe token shapes, high-entropy strings next to
key-like words, and credentials embedded in URLs are replaced with
`[redacted]`.

The commit that carries these files is authored as
`<handle>@synchrobuilder.invalid` and its message starts with `[skip ci]`.
Your real email is not used unless your team opts in for a git host that
enforces author rules (`transport.realEmail` in
`.synchrobuilder/config.json`). Opting in puts the address in the author field
of the state commits this plugin pushes, and nowhere else: it is not written to
`identity.json` and never appears in a published file.

## The task summary is opt-in

The task summary is the first line of your most recent prompt, cut to 140
characters and redacted. It is the only field that comes from what you typed
to Claude, so it is off by default: unless `.synchrobuilder/config.json` sets
`"presence": { "shareTask": true }`, the prompt hook records no prompt text at
all, and both `presence.json` and the `task` and `done` fields of a staged
handoff carry no prompt-derived text. What you pass to `handoff` yourself is
published as you wrote it.

## What never leaves your machine

- Your prompts, Claude's replies, transcripts, or any part of a conversation,
  with the one opt-in exception above.
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

The pre-edit hook is the one hook that talks to the network, and only to that
same git remote: the first time a file is edited it pushes the lease ref
described above. Every other hook reads local files only.

Logs contain error messages and timings. They never contain prompts or file
contents.

## Who can see what you publish

Anyone who can fetch the repository can read the files above. On a public
repository that is everyone, so the worker does not publish there by default:
before publishing it asks GitHub, without credentials, whether the repository
is public, and if it is, it keeps pulling teammates' state but pushes nothing
of yours. `synchrobuilder status` says so. A team that wants presence on a
public repository sets `"transport": { "allowPublic": true }` in
`.synchrobuilder/config.json`.

The check only exists for github.com remotes. Any other host, and any failure
of the check itself, counts as not public and publishing goes ahead, so on
GitLab, Bitbucket or a self-hosted server the visibility of the repository is
yours to know. `synchrobuilder doctor` warns when the remote's state refs are
readable without credentials.

## Website

The website sets no cookies, loads no third-party scripts or fonts, and
records nothing.
