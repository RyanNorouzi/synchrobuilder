# ADR-002: Developer identity

- Status: Proposed (awaiting approval at the end of Phase 0)
- Date: 2026-09-18
- Deciders: lead engineer, project owner

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
   claims (fail open, ADR-003).
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
  (ADR-001 §1); that is a visible setting in `team.json`. The team file is
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
  survive a reinstall; kept as a secondary `machineId` inside presence so two
  sessions of one developer on two machines can be told apart.
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
- Not yet verified: behavior in git worktrees (`.git` is a file pointing at
  the common dir); hooks resolve the common dir by reading the `gitdir:`
  and `commondir` files (no git process), and the worker confirms it with
  `git rev-parse --git-common-dir` once per session.
