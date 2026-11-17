# ADR-007: Leases, the atomic primitive for simultaneous work

- Status: Accepted
- Date: 2026-11-16
- Deciders: project owner
- Amends: ADR-001 section 6 (hooks read local files only) and ADR-003 section 3
  (hooks never refuse), each for one bounded path described below.

## Context

Synchrobuilder's goal is several Claude Code sessions working in one
repository at the same time. Up to 0.2.x every coordination signal was
advisory and up to a sync interval old:

- A session's edits and claims travelled journal, worker, push, fetch,
  snapshot. That is 45 to 60 seconds between machines. Two agents that started
  on the same file inside that window never heard about each other.
- A claim is an intention ("I am on this area"), good for four hours, made by
  a command somebody has to remember to run. It cannot be enforced across
  machines, because a claim says nothing about whether its author is still
  there.
- The one refusal that existed, `collision.mode = block`, covered claims by a
  live agent on the same machine only, was opt-in, and was a read followed by
  an edit: two siblings could both read "nobody holds this" and both proceed.

So the system could tell agents about each other after the fact. It could not
guarantee that two of them never change one file at the same moment, which is
the property simultaneous work needs.

## Decision

Add one primitive, the **lease**: an exclusive, short-lived hold on one file,
taken atomically and automatically the moment an agent starts to edit it.

### 1. A lease is a fact about now, a claim is an intention

Claims are unchanged: advisory, long-lived, directories allowed. A lease is
held only while its holder is demonstrably alive, and that is what makes it
safe to enforce:

- It is taken by the pre-edit hook, not by a command. No one has to remember.
- It ends when the file has not been touched for `leases.idleMinutes` (15),
  when the session that took it ends, or when it is released.
- On the remote it carries an expiry `leases.ttlMinutes` (10) ahead, and only
  the holder's running worker pushes it forward. A machine that crashes, sleeps
  or loses its network stops renewing, and the lease lapses without anyone
  doing anything.

### 2. Two tiers, cheapest first

**This machine.** `<remoteDir>/leases/<hash>.json`, one file per key, in a
directory every working tree of the remote shares. Every mutation runs under a
directory mutex held for microseconds, so take-over is not a read followed by
a write. Liveness is exact: the holding session's process is alive or it is
not. Resolves in a file read. This covers agents in sibling worktrees.

**The remote.** One ref per key, `refs/synchrobuilder/lease1/<hash>`, written
by compare-and-swap push:

- acquire: `git push --force-with-lease=<ref>: <sha>:<ref>`. The empty
  expectation means "this ref must not exist".
- renew or take over: `--force-with-lease=<ref>:<sha I read>`.
- release: the same expectation with an empty source, which deletes the ref
  only if it is still ours.

A git server applies a ref update only if the ref still has the value the
client named, under its own ref lock. That makes the remote an atomic
compare-and-swap store that any number of machines can race for with exactly
one winner, with no server of ours. The lease document (`handle`, `device`,
`seat`, `path`, `at`, `exp`) is the commit message of a parentless commit on
the empty tree, so writing one costs a single local git process before the
push.

`<hash>` is the first 40 hex characters of SHA-256 over the NFC, lower-cased
key `f:<repo-relative path>`. Lower-casing means a case-insensitive machine
and a case-sensitive one agree on the lease for a file; the cost is that two
files differing only in case share a lease.

### 3. When the remote tier is used

Only when all of these hold, so a developer alone pays nothing and leaves
nothing on their remote:

- `leases.remote` is not `never`;
- the transport is in `custom` mode (a hidden ref namespace exists; in branch
  mode every lease would be a visible branch, so leases stay local there);
- publishing is not held back for a public repository (a lease names a handle
  and a path, which is what that hold keeps off a world-readable remote);
- the worker has synced successfully at least once;
- a writer on another device has been seen in the last seven days, or
  `leases.remote` is `always`;
- the network did not fail in the last minute (a breaker, so being offline
  costs one timeout and not one per edit).

### 4. What the hook does, and the two amendments

`PreToolUse` for `Edit|Write|NotebookEdit` now runs `leaseGuard` before the
collision check:

1. Already mine, with time to spare: allow. No network.
2. Held by a live agent on this machine: refuse.
3. Otherwise take it locally. If the remote tier applies, push. Rejected means
   somebody has it: fetch that one ref, and if it is unreadable, mine from
   before, or expired past a two minute grace period, replace it by
   compare-and-swap; otherwise refuse and give the local slot back.
4. Any failure that is not "someone else holds it" allows the edit.

**Amendment to ADR-003 section 3.** With `leases.mode = enforce`, which is the
default, a refusal is `permissionDecision: "deny"` with a reason that tells the
agent who holds the file, to do other work, when the hold ends, and how a
person overrides it. This is the second path on which a hook refuses, and the
first that is on by default. It is justified by what it refuses: only an edit
that would collide with another agent's edit in progress, on positive
knowledge, never on a failure. `warn` reports instead; `off` takes no leases.
A holder whose handle is not in `team.json`, when that file exists, is
reported and never enforced, since anyone with push access can write a lease
under any handle.

**Amendment to ADR-001 section 6.** The pre-edit hook may now reach the
network, for the push in step 3: once per file, only when a teammate on
another machine exists, under a 6.5 second deadline inside an 8 second
watchdog (the hook's Claude Code timeout is raised from 5 to 10 seconds). When
the deadline passes the edit is allowed and the worker takes the remote lease
on its next tick.

### 5. Upkeep, in the worker

Once per tick, only in the worker that holds the lock: delete the refs of
leases that ended; renew those past half their life; take on the remote any
lease the hook could only take locally; compare every held lease with one
fetch of the namespace and flag any whose ref changed without us (`contested`),
so the next edit goes to the remote and is refused there; write the view
`status` and `lease` show; delete refs nobody has renewed for an hour.

### 6. Override

`synchrobuilder lease take <path> --force` replaces a lease whoever holds it.
It is for a person, to free a file whose holder is not coming back, and the
skill that wraps it is not model-invocable.

## Consequences

- Two agents can no longer both begin on one file, on one machine or across
  machines. The loser is told at once and does other work instead of producing
  a conflict later.
- The first edit to each file costs a push when a remote teammate exists.
  Measured against GitHub from Windows on 2026-11-16: about 1.7 s to acquire,
  2.2 to 2.9 s to be refused, about 0.2 s for every later edit of the same
  file.
- Coordination is per file. Two agents that must both change one hot file take
  turns: the second waits for the first to go idle or release, pulls, then
  edits.
- An agent that changes a file through the shell (`sed`, a script, a
  formatter) is not seen by the hook and takes no lease.
- A lease taken while offline is local only until the worker reaches the
  remote. In that window another machine can take the same file; the worker
  finds out on its next tick and flags it, and the next edit is refused.
- Clocks matter. A holder treats its lease as valid until one minute before
  expiry and others take over only two minutes after it, and a live lease is
  renewed at half its life, so the scheme tolerates several minutes of skew
  but not unbounded skew.
- Anyone with push access can write a lease and so hold a file for as long as
  they keep renewing it. `team.json`, `leases.mode = warn` and `--force` are
  the mitigations; signed state remains the real fix (ADR-002).

## Alternatives considered

- **A hosted lock service.** Sub-second and simple, and it ends "no server".
  Rejected for that reason; `docs/hub-api.md` keeps the door open.
- **Faster polling of the existing claims.** Shrinks the window and never
  closes it: a read followed by an edit is not atomic at any interval.
- **Optimistic: edit first, check after, tell the loser to undo.** No wait on
  the first edit, at the price of the conflict the feature exists to prevent
  and an agent asked to revert work. Kept as a possible opt-in later.
- **Leases on regions of a file.** Line ranges are only comparable against a
  common base, and two machines rarely have one. File granularity is the
  coarsest unit that is always well defined.
- **Making `claim` take a lease.** Claims last hours and cover directories;
  enforcing them would block people over an intention. Kept separate.

## Evidence and verification

- `git push --force-with-lease=<ref>:` picks exactly one winner among
  simultaneous creators, and a `+` on the refspec silently defeats the lease
  check (the push is forced and wins over a ref it should have lost to). Both
  measured against a local bare remote and against GitHub on 2026-11-16. The
  code never uses `+` on a push.
- `tests/unit/leases.test.mjs`, `tests/unit/lease-upkeep.test.mjs`: the rules
  above against a fake compare-and-swap store, with the clock passed in.
- `tests/unit/lease-refs.test.mjs`: the compare-and-swap contract itself,
  against a real bare remote.
- A lost race must never be read as a transport failure, because a transport
  failure lets the edit through. The shared classifier once did exactly that
  when a commit id contained `401` or `403`; the lease code now takes git's
  own `[rejected]` verdict first and treats anything that is not plainly the
  network or credentials as "someone has it", to be settled by reading the
  ref.
- `tests/e2e/leases.test.mjs`: two homes, two clones, one real bare remote,
  the real hooks, CLI and worker. Includes five rounds of two pre-edit hooks
  started at the same moment on the same new file, with exactly one refusal in
  every round, and two worktrees on one machine.
- `scripts/hosted-lease-check.mjs`: the same flow against a hosted remote.
  Run against a private GitHub repository on 2026-11-16: eight of eight checks
  passed, including four of four simultaneous races with exactly one winner.
- Not verified: see `docs/VERIFICATION.md`.
