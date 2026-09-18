# ADR-001: Multiplayer transport over the team's existing git remote

- Status: Proposed (awaiting approval at the end of Phase 0)
- Date: 2026-09-18
- Deciders: lead engineer, project owner
- Evidence: `docs/research/experiments.md` (E5, E8),
  `docs/research/evidence/transport-design-panel.json` (three design
  proposals and two adversarial judges with their local git experiments)

## Context

Pillar B needs several developers' Claude Code sessions to share presence,
claims, messages, a task board and handoffs with nothing to host. The brief
recommends an orphan branch with one writer per file, a background sync
loop, and hooks that only read a local cache. The docs add hard constraints:
there is no long-lived hook type; async hook output waits for the next turn;
plugin monitors are experimental, interactive-only and disabled by
telemetry opt-outs; `SessionEnd` gives plugin hooks 1.5 s; hooks must not
run git if they are to stay under 50 ms.

Three designs were drafted from different angles and judged adversarially
(see the evidence file). The judges disagreed on the base design and agreed
on the synthesis below. Their most important findings:

- A **single shared ref** that every writer must read before writing (the
  orphan-branch design) is a single point of poison: a teammate who pushes
  a valid tree with a blob where the `state/` directory should be jams every
  other writer's `read-tree`, and the design's own recovery path reads the
  same tip. Reproduced locally.
- **One ref per writer** removes the read-before-write dependency: the
  writer's four git calls touch only objects it created, a flooding or
  hostile teammate cannot stop anyone publishing (verified: 56 ms per push
  while another process pushed 139 times), and an overwritten ref self-heals
  in one extra round trip with `--force-with-lease`, never bare `--force`.
- Fetching two remote namespaces into **one** local namespace fails with
  `fatal: Cannot fetch both`; each remote namespace needs its own local one.
- Pushes to `refs/heads/*` trigger `on: push` CI workflows, webhooks and
  notifications on every tick unless the commit says `[skip ci]` and the push
  uses `-o ci.skip`; a custom ref namespace avoids this and is invisible in
  branch UIs. GitHub's reference API accepts any name that starts with
  `refs/` and has two slashes; other hosts are unverified.
- `git push --mirror` from a teammate's ordinary clone deletes every state
  ref; both designs self-heal on the next tick.
- Every push downloads the remote's full ref advertisement (12 MB at 100k
  refs), so the heartbeat interval must scale with advertisement size.
- Writing anything inside the user's `.git` fails on read-only or
  ACL-restricted repositories; the plugin should keep all of its state in
  its own directory and find it from the hook's cwd with file reads only.

## Decision

### 1. Data model: one ref per writer, snapshot commits, no merges ever

- Each (developer, device) publishes exactly one ref:
  `refs/synchrobuilder/v1/<handle>/<device>`. `<handle>` follows ADR-002;
  `<device>` is a random 8-hex id generated once per machine and stored
  locally, never the hostname.
- The ref's tip is always a **parentless snapshot commit** whose tree holds
  only that writer's files: `presence.json`, `claims.json`, `board.json`,
  `contracts.json`, `messages/<ulid>.json`, `handoffs/<ulid>.json`, plus
  `manifest.json` (`{handle, device, schemaVersion}`) which readers check
  against the ref name.
- The writer builds the commit with plumbing only (`hash-object -w
  --stdin`, `mktree`, `commit-tree`) and pushes with
  `--force-with-lease=<ref>:<lastKnownSha>` (empty lease on first push).
  On `stale info` it re-reads the remote sha and leases again. It never
  fetches or reads anyone else's state before writing, so nothing a
  teammate pushes can stop it.
- Commit author is `<handle>@synchrobuilder.invalid` by default (the
  developer's real email is an opt-in for hosts with author rules), and
  every commit message starts with `[skip ci]`.
- The writer ref is the outbox. Local truth is the journal under the
  plugin's own state directory; every tick rebuilds the tree from it, so
  offline work is published on the first successful push and nothing is
  queued separately.

### 2. Reader: fetch the namespace, validate, fold into one snapshot

`fetch --no-tags --prune <remote> '+refs/synchrobuilder/v1/*:refs/sb-remote/custom/v1/*'`
(protocol v2 sends the ref prefix, so a no-change fetch is one small
request), then `for-each-ref`, `ls-tree -r -z` and one `cat-file --batch`
per changed ref. Every path, mode, size and JSON document is validated
(ADR-005 §S0) before it can reach the snapshot: only blobs of mode 100644
or 100755, at most 64 KB each, 20 files per writer, 1 MB per sync; path
segments rejected if they contain `..`, `.git`, leading `/`, drive letters,
NUL or Windows reserved names; `fetch.fsckObjects` is set off explicitly in
the hidden repo (we never check anything out) because a single hostile ref
would otherwise fail the whole multi-ref fetch. A ref whose manifest does
not match its name, or whose handle is not in `team.json`, is kept in an
"unverified" bucket that never reaches hook context. The fold writes
`snapshot.json` atomically (temp file plus rename) and never overwrites it
on a failed tick; it records `fetchedAt`, `transport.status` and the local
first-seen time of every (writer, sha) so staleness and ordering use the
reader's clock.

### 3. Host fallback ladder

1. Custom namespace `refs/synchrobuilder/v1/...` (default; hidden from
   branch UIs, outside branch rulesets).
2. If the host rejects it (classified by the push error text), branch
   namespace `refs/heads/synchrobuilder/v1/<handle>/<device>` in
   **fast-forward append mode**: each snapshot commit is parented on the
   previous one, pushed without force, `[skip ci]` plus `-o ci.skip`; a
   weekly re-root with `--force-with-lease` is attempted and simply skipped
   where force pushes are blocked. Readers fetch this namespace into
   `refs/sb-remote/heads/v1/*` and fold both namespaces by newest commit.
3. If both are rejected: read-only (fetch only) or local-only, with the
   reason in `transport.status` so the digest can say "team state as of
   10:32Z, publishing blocked: <server text>".

The mode is probed at setup, recorded per remote, and re-probed in both
directions when an error class changes.

### 4. Hidden bare repo and git runner hygiene

All git work happens in a plugin-owned bare repository under
`~/.synchrobuilder/remotes/<sha256 of normalized remote URL>/state.git`,
never in the user's `.git`. Normalization maps SSH, HTTPS, scp-style and
`.git`-suffixed spellings of one remote to one key. Git is always spawned
as an argv array (`spawnSync('git', [...])`, no shell), with `--git-dir`
explicit, cwd set to the hidden directory, `GIT_DIR`/`GIT_WORK_TREE`/
`GIT_INDEX_FILE` stripped from the environment, `--template=` at init,
`core.hooksPath` pointing at an empty directory, `gc.auto=0`,
`commit.gpgsign=false`, `GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`,
`SSH_ASKPASS_REQUIRE=never`, per-call timeouts (20 s fetch, 30 s push), and
credentials taken from the user's global git configuration only. Repo-local
credential keys are never copied into a second file; forwarding selected
keys through `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n` is
a Phase 5 experiment. Errors are classified (`rejected`, `no-ref`, `auth`,
`policy`, `network`, `ssh-hostkey`, `unknown`) with backoff from 30 s to
10 min, 15 min for `auth`.

### 5. Process model

- **Baseline**: a detached Node worker per (machine, remote), spawned from
  the `SessionStart` hook when no live worker holds the lock
  (`spawn(process.execPath, [...], {detached: true, stdio: 'ignore',
  windowsHide: true}).unref()`, verified on macOS in E5; parent exits in
  under 40 ms). The lock is a directory with a pid and heartbeat; takeover
  happens only when `process.kill(pid, 0)` says the pid is dead, never on
  heartbeat age alone, because a sleeping laptop stops heartbeats. The
  worker re-checks the lock before every git spawn and exits if it lost it.
- Cadence: fetch every 30 s plus 0 to 15 s jitter; push only when own state
  changed or 60 s passed (presence heartbeat); important events (claim,
  release, notify, board change, handoff, session closed) are written by
  hooks to a kick file and cause a tick within about a second; the interval
  stretches automatically when the remote's ref advertisement is large.
- The worker exits when every registered session pid is dead or has written
  a closed marker (verified locally by the third proposal: a detached child
  exited about 100 ms after the watched pid died). An async `Stop` hook acts
  as a keeper that relaunches a dead worker; if detached spawning proves
  unreliable on a host, the same tick code runs bounded inside that async
  hook (no idle-time sync, everything else unchanged).
- Optional accelerators, each behind a team flag and each a Phase 6
  experiment: a plugin monitor that prints one line per urgent event, and
  hosting the worker inside a plugin MCP server (PLAN.md open question 2).

### 6. What hooks do

Hooks never run git and never touch the network. They locate the checkout
by walking up from `cwd` to the `.git` entry, follow `gitdir:` and
`commondir` files by reading them, hash the raw `remote.origin.url` from
`.git/config` the same way the worker does, and read
`~/.synchrobuilder/remotes/<key>/snapshot.json` plus their own per-checkout
directory `~/.synchrobuilder/checkouts/<sha256 of common dir>/`. All local
writes by hooks are appends to the journal or kick file in that directory.
The staleness ladder is applied at render time: snapshot under 5 min old,
full policy; 5 to 15 min, "ask" degrades to "warn"; over 15 min, warn only
with an "as of HH:MMZ" stamp; over 24 h, only the digest mentions that
sync is stale. Stale data never blocks and never asks.

### 7. Interface

```js
// lib/transport/interface.mjs
export class Transport {
  async probe()            // -> { mode: 'custom'|'branch'|'readonly'|'local', detail }
  async publish(tree)      // tree: { 'presence.json': Buffer, ... } -> { sha, status }
  async pull()             // -> { writers: [{handle, device, sha, files}], status }
  status()                 // last classified error, mode, timestamps
}
```

`GitRefsTransport` is the v1 implementation. A hosted hub implements the
same four methods; `docs/hub-api.md` (Phase 5) sketches it. Hooks and
commands depend only on the snapshot format, not on the transport.

## Consequences

- No hosting, no accounts, no tokens; a team that can push to a remote can
  use it. Anyone with push access can write any ref, so identity is a claim
  (ADR-002) and every field is untrusted (ADR-005).
- The custom namespace is hidden from branch UIs and CI, which is a feature
  for noise and a fact the setup consent screen must state: presence and
  messages are readable by anyone who can fetch the repo, including the
  world for public repositories (`doctor` warns using `git ls-remote`).
- Stale devices are ignored by readers after 30 days without presence; v1
  issues no deletes at all (they collide with "restrict deletions" rules).
  A lease-protected cleanup command may come later.
- The plugin owns a directory under the user's home. Uninstall
  instructions and `npx synchrobuilder clean` remove it.
- Deviation from the brief: the hidden repo lives under `~/.synchrobuilder`
  rather than `.git/synchrobuilder/`, so the user's repository is never
  written to (recorded in `docs/research/conflicts.md` §16).

## Alternatives considered

- **Single orphan branch, one writer per subtree, push compare-and-swap**
  (proposal 1). Best fail-open story for accidents and verified under a real
  push race, but the shared tip is a read-before-write dependency that a
  hostile or buggy teammate can poison for everyone. Its runner hygiene,
  error classification and staleness ladder are adopted above.
- **Orphan branch with sync clones holding working trees** (proposal 3's
  storage). Rejected for the same reason plus disk and checkout cost; its
  worker liveness design is adopted.
- **Plugin monitor as the sync loop.** Rejected as baseline (experimental,
  interactive-only, telemetry-coupled, shell-launched, survives plugin
  disable); kept as an optional accelerator.
- **Channels.** Require per-launch flags and a development warning outside
  the official marketplace; not for v1.
- **A hosted hub.** Out of scope by the brief; the interface keeps the door
  open.

## Evidence and verification

Verified locally (git 2.39.5, macOS): worktree-less commits with
`hash-object`/`mktree`/`commit-tree`; push and force-push of a custom ref;
fetch of the namespace by a second clone and by a shallow clone with user
branches untouched (E8); detached worker survival (E5); server-side
compare-and-swap rejection under a 2 s race; recovery after `push
--mirror`; poisoned shared tip blocking subtree replacement; per-writer
refs unaffected by a flooding or poisoning teammate; the `Cannot fetch
both` failure; `stale info` on a wrong lease and success on a re-read lease
(all in the panel evidence file).

Not verified, listed as Phase 5 acceptance experiments: acceptance of the
custom namespace and behavior of rulesets on GitHub, GitLab, Bitbucket,
Azure DevOps and Gitea; `[skip ci]`/`-o ci.skip` suppression; detached
worker survival on Windows (Job Objects) and Linux and across interactive
teardown; `git.exe` and credential-manager behavior from a background
process on Windows; real-network tick cost against large-ref remotes;
repo-local-only credentials; two checkouts and linked worktrees of one
remote on one machine; laptop sleep mid-push.
