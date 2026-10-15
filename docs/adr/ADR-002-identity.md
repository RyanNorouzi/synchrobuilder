# ADR-002: Developer identity

- Status: Proposed (awaiting approval at the end of Phase 0)
- Date: 2026-09-18
- Deciders: lead engineer, project owner
- Amended: 2026-10-15, see "Amendment 2026-10-15: the seat, a third
  addressing axis" at the end. The decision below is the original text; the
  amendment says which parts of it no longer describe the code.

## Context

Every piece of shared state (presence, claims, messages, handoffs, tasks) is
attributed to a developer, and the transport (ADR-001) gives each developer a
private write namespace named after them. The brief rules out accounts,
passwords and tokens in v1. Hooks that need the identity run before every
prompt and every edit and must finish in well under 50 ms using local file
reads only, so they cannot shell out to `git` on the hot path.

## Decision

1. **A handle is the identity.** A handle is a short string matching
   `^[a-z0-9][a-z0-9-]{0,31}$`. This is deliberately a subset of what git
   allows in a ref name and what every file system allows in a path, because
   the handle appears in both (`refs/synchrobuilder/<handle>`,
   `state/<handle>/...`).
2. **Handles are declared in a committed team file** at
   `.synchrobuilder/team.json`:

   ```json
   {
     "version": 1,
     "members": {
       "alice": { "name": "Alice Example", "emails": ["alice@example.com"] },
       "bob":   { "name": "Bob Example",   "emails": ["bob@example.com", "bob@old-domain.example"] }
     }
   }
   ```

   Only names, handles and email addresses that are already in the git
   history appear here; no secrets. `/synchrobuilder:init` offers to seed it
   from `git log --format=%ae` authors (with confirmation) and
   `/synchrobuilder:iam` can add the current developer.
3. **Resolution order** (first match wins):
   1. A per-machine, per-checkout override written by `/synchrobuilder:iam
      <handle>` to `~/.synchrobuilder/checkouts/<key>/identity.json`, where
      `<key>` is the hash of the checkout's common git directory (ADR-001
      §6). Nothing is ever written inside the user's repository or its
      `.git`, so it can never be committed and needs no `.gitignore` entry.
      (Amended 2026-10-15: `<key>` is the hash of the working tree's own git
      directory, so the override is per working tree.)
   2. The email from `git config user.email` (repo config wins over global,
      which is git's own precedence), matched case-insensitively against
      `members.*.emails`.
   3. If the email is unknown, a **provisional handle** derived from the email
      local part (lower-cased, non-matching characters replaced by `-`,
      truncated to 32). The status output labels it "not in team.json" and
      suggests `/synchrobuilder:iam`. Provisional handles still work, so a
      new teammate is never blocked.
4. **The hot path never runs git.** The background worker (ADR-001) resolves
   the email by running `git config user.email` once per session, and writes
   the resolved identity to `~/.synchrobuilder/checkouts/<key>/identity.json`
   (`{"handle": "alice", "device": "3f9a1c2e", "source": "team.json",
   "email": "alice@example.com", "resolvedAt": "..."}`). Hooks read that
   file. `device` is a random 8-hex id generated once per machine and used
   as the second segment of the writer's ref name (ADR-001 §1). If it is missing, hooks treat
   the developer as anonymous for that turn and stay silent about teammates'
   claims (fail open, ADR-003). (Amended 2026-10-15: the ref has a third
   segment, the seat, and the file holds no `email` field.)
5. **Identity is a claim, not authentication.** Anyone with push access to the
   remote can write any namespace. v1 documents this plainly: Synchrobuilder
   trusts your repository's access control and nothing else. Readers therefore
   treat every field from any namespace as untrusted data (ADR-005), and the
   UI always shows the namespace the data came from, never a display name
   alone.

## Consequences

- No sign-up, no server, no tokens; a teammate is identified the moment they
  clone the repo and have a git email set.
- Two developers who share one email (pairing on one machine) collide; the
  `iam` override exists for exactly that case.
- The email never leaves the machine by default. Only the handle is pushed;
  state commits are authored as `<handle>@synchrobuilder.invalid`. A team may
  opt in to real-email authorship for hosts whose push rules require it
  (ADR-001 §1); that is a visible setting in `team.json`. (Corrected
  2026-10-15: the setting is `transport.realEmail` in
  `.synchrobuilder/config.json`. Nothing reads it from `team.json`.) The team file is
  the only place emails appear, and it is already public to anyone who can
  read the repo's git history.
- Impersonation is possible for anyone who can push. Signed state commits
  (`git commit-tree -S`) are a possible v2 hardening and are listed in
  `docs/hub-api.md` as something the hosted hub would solve with real
  accounts.
- Renaming a handle is a manual edit of `team.json` plus a fresh
  `/synchrobuilder:iam`; old state under the old handle expires with the
  normal presence timeout.

## Alternatives considered

- **GitHub username via `gh api user`.** Rejected: needs `gh` and network on a
  path that must work offline, and not every team is on GitHub.
- **`git config user.name`.** Rejected: names are not unique or stable and
  contain spaces and Unicode, which makes bad ref and path components.
- **A random per-machine ID stored in `${CLAUDE_PLUGIN_DATA}`.** Rejected as
  the primary key: it is not human-readable in the status line and does not
  survive a reinstall; kept as the `device` id described in §4, which appears
  in the writer's ref name and in `presence.json`, so two sessions of one
  developer on two machines can be told apart. (Corrected 2026-10-15: this
  bullet called it a secondary `machineId` inside presence. There is no
  `machineId` field anywhere in the code; `device` is the field.)
- **Accounts in a hosted hub.** Out of scope for v1 by the brief; the
  interface in ADR-001 leaves room for it.

## Evidence and verification

- `git config user.email` precedence (local over global) is git's documented
  behavior; we verified on this machine that the repo had no identity
  configured until we set one, which is exactly the "provisional handle"
  case new teammates will hit (see `docs/research/experiments.md`).
- Whether reading the per-checkout identity file stays inside the 50 ms
  hook budget is covered by experiment E4 (a hook reading one small file costs
  about 20 ms end to end on the test laptop).
- Corrected 2026-10-15: hooks and the worker both resolve the git directory
  and the common directory by reading the `gitdir:` and `commondir` files,
  with no git process. This bullet previously said the worker confirmed the
  common directory with `git rev-parse --git-common-dir` once per session. No
  such call was ever written, so that sentence described code that does not
  exist. Worktree behavior is no longer unverified either:
  `tests/unit/paths.test.mjs` covers the `gitdir:` and `commondir` walk, and
  `tests/unit/workspace-seats.test.mjs` runs real `git worktree add` and
  checks the keys that come out of it.

## Amendment 2026-10-15: the seat, a third addressing axis

The decision above stands as written in every other respect: a handle is the
identity, it comes from the `iam` override, `team.json` or the git email in
that order, identity is a claim and not authentication, and the hot path never
runs git. What changed is the address a handle sits in.

### What changed

- A participant is a (handle, device, seat) triple. A seat is one git working
  tree. `workspaceKey()` in `lib/core/paths.mjs` hashes the working tree's own
  git directory instead of the common one and returns sixteen hex characters,
  and that value is both the name of the state directory and the published
  `seat`.
- A plain clone keeps the key it already had, because there the working tree's
  git directory and the common directory are the same path, so no existing
  state directory moves. A linked worktree now gets its own key instead of
  inheriting the main checkout's.
- One consequence of that is in §3.1: the `iam` override is per working tree.
  Setting it in the main checkout does not set it in a linked worktree.
- `device` is unchanged, one random 8-hex id per machine. Keeping it is what
  lets a reader tell a seat on this disk from a writer that arrived over the
  network, which the same-machine path in `lib/features/siblings.mjs` depends
  on.
- The seat is published in `manifest.json` and `presence.json`, and a tree
  whose manifest names a seat its ref does not is rejected the same way a
  wrong handle or device already was (`lib/transport/reader.mjs`). The seat is
  a one-way hash of a local path, so the path itself does not leave the
  machine, but the id is stable and does identify one working tree over time.
- `identity.json` holds `handle`, `device`, `source` and `resolvedAt`, and no
  email. The example in §4 showed an `email` field; it is not written.
  `resolveIdentity()` now carries the address on the object it returns, in
  memory only, which is what makes the `transport.realEmail` opt-in described
  in ADR-001 §1 take effect at all. Before this change nothing ever set that
  field, so the opt-in silently did nothing. The address is still never
  persisted and never published.
- The writer ref grew a third segment. That is an ADR-001 matter and is
  recorded in its own amendment there.

### Why it was needed

Two agents in two worktrees of one clone were not two participants that synced
slowly. They hashed to one state directory, one journal and one writer ref,
and `isSelf` matched them as the same person, so each filtered the other out
of its own teammate view. Every teammate surface was empty by construction.
Deciding "is this me" on handle and device alone cannot separate them, because
they genuinely share both: one person, one machine, one git email.

### What it costs

- One ref per working tree instead of one per machine. A developer with a main
  checkout and two worktrees publishes three refs, so the ref count is no
  longer bounded by the team's headcount. That eats headroom under
  `MAX_WRITERS` (500 writers kept per tick, `lib/transport/git-refs.mjs`) and
  `LIMITS.bytesPerSync` (1 MB per sync, `lib/core/schema.mjs`), neither of
  which changed, and it brings forward the point at which ADR-001 §5's rule
  about stretching the interval with the remote's ref advertisement starts to
  bite.
- A tick builds one tree per registered seat and pushes each seat whose tree
  changed, where before it built and pushed one, so the git work in a tick
  scales with the number of seats on this machine against that remote. One
  fetch still serves all of them.
- `isSelf` carries a compatibility rule rather than a single comparison: it
  falls back to handle and device whenever either side has no seat, so an
  upgrade never shows a developer their own work as a teammate's. That rule
  has to stay until no pre-seat refs remain.

### Evidence

`tests/unit/workspace-seats.test.mjs` covers the addressing and
`tests/e2e/worktree-agents.test.mjs` drives two agents in two worktrees end to
end. Both were run on macOS on 2026-10-15. `docs/VERIFICATION.md` records
exactly what they assert and what is still unverified.
