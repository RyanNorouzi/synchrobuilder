# Prior art

Two things sit closest to Synchrobuilder's Pillar B: a community project,
`worklab-studio/claude-code-relay`, and Anthropic's own multi-session
features (Agent Teams and cross-session messaging). This note says what each
does, what we take from it, and where Synchrobuilder differs. Quotes from
Relay come from a shallow clone at commit `e6f2957` (2026-09-13) read on
2026-09-18; the detailed file-by-file notes are in
`prior-art-relay-notes.md`. Quotes from Anthropic's docs come from the
snapshots described in `README.md`, via
`agent-teams-and-cross-session-messaging.md`.

## 1. claude-code-relay (MIT)

**What it is.** "Team presence, collision warnings, contract impact routing
and automatic handoffs for developers on Claude Code" (its `plugin.json`).
A Claude Code plugin per developer plus a hub the team hosts: "Hono on
Vercel Functions ... Drizzle, Neon/PGlite" (`DESIGN.md` §2.2). License:
MIT, "Copyright (c) 2026 Relay contributors" (`LICENSE`). Language:
TypeScript bundled by esbuild into committed `dist/hook.mjs` (about 200 KB)
and `dist/mcp.mjs` (about 800 KB, bundles the MCP SDK). "Requirements:
macOS or Linux, Node ≥ 20, pnpm 10, git" and "Windows is untested."
(`README.md` L96, L185).

**How it works.** Hooks on `SessionStart`, `UserPromptSubmit`, `PreToolUse`
(`Edit|Write|MultiEdit|NotebookEdit`, plus a `Read` guard), `PostToolUse`
(async), `TaskCreated`, `TaskCompleted`, `CwdChanged`, `Stop` (async) and
`SessionEnd` (`packages/plugin/hooks/hooks.json`). Every hook is declared in
exec form as `/bin/sh` running `scripts/hook.sh <verb>`, a POSIX script that
searches for a Node ≥ 18 binary (PATH, Homebrew, nvm, Volta, fnm), caches
the path, unsets `NODE_USE_SYSTEM_CA`, and `exec`s the bundle. The
latency-critical hooks read only a local snapshot cache
(`~/.relay/cache/<repo>/snapshot.json`) that the hub returns on every
request; edits and turns are journaled locally, written to an outbox
(write-ahead log) and posted to the hub by detached workers. Presence,
claims, change sets, impact routing, digest rendering and handoff synthesis
(optionally via the Anthropic API with Haiku) live on the hub. An MCP server
with 13 tools lets Claude query and notify. A `statusLine` shows presence.
Identity is git email mapped through a `team.json` that also carries the
hub URL and a shared team token (`packages/plugin/team.json.example`).

**What leaves the machine** (their words, `README.md` L85-L88): "a derived
objective (≤ 140 chars), repo-relative file paths, contract-file diff hunks
(≤ 1,500 chars) and the code-stripped prose of Claude's replies (≤ 3,000
chars). Never prompts, source files or transcripts. All of it passes secret
redaction first."

**What they verified** (`docs/VERIFICATION.md`): the whole flow through
`claude -p` on CLI 2.1.236 with the plugin installed through a local
marketplace; hook timings (session-start p50 197 ms, prompt p50 8 ms,
pre-edit p50 6 ms); that `ask` is downgraded to context in `-p`; that the
async `Stop` hook is cancelled at teardown in `-p`; and a crash they
attribute to `NODE_USE_SYSTEM_CA=1` on Node 24.7. Everything interactive
(trust dialog, permission prompt, status line rendering) is listed as not
yet observed.

**What we take from it, with credit.**

- The shape of the client: hooks that only read a local snapshot, a local
  journal of session events, an outbox that survives being offline, and a
  background worker that does all network and git work. Synchrobuilder
  keeps this shape; ADR-001 replaces the hub with the git remote.
- Advisory collisions with a staleness ladder ("never block on stale
  data", `DESIGN.md` §6.5) and five collision levels ("claimed / hot / warm
  / sequential / same-dev", `README.md` L48), asked at most once per file
  per window. We adopt the once-per-file throttle and the idea that stale
  data always downgrades to a note.
- A derived objective of at most 140 characters, computed locally from
  branch name, recent edits and task text, as the "task summary".
- A heuristic handoff built from the session's own event stream, never from
  transcripts (their default when no API key is set).
- The list of platform gotchas to re-verify: Desktop sessions with a minimal
  `PATH`, the 1.5 s `SessionEnd` budget, `ask` in headless mode, the
  per-project install record, and the Node 24.7 crash (we could not
  reproduce it on 24.16; see `experiments.md` E6).
- Their recorded hook inputs under `scripts/smoke/` are MIT-licensed test
  fixtures; we recorded our own instead (`evidence/`), so no code is
  copied. If we ever copy code, its MIT notice and a credit line go in the
  file header and in `NOTICE`.

**Where Synchrobuilder differs, on purpose.**

| Relay | Synchrobuilder |
| :-- | :-- |
| Requires a hub you host (Vercel plus Postgres) and a shared team token | No server. State travels through the team's existing git remote (ADR-001); no tokens (ADR-002) |
| Hooks go through a `/bin/sh` wrapper that locates Node | Hooks are exec-form `node` with no shell; Windows without Git Bash is a supported target (ADR-003) |
| TypeScript, esbuild bundles, pnpm workspace, MCP SDK bundled | Plain ESM, no build step, no dependencies (ADR-003) |
| Sends Claude's code-stripped reply prose (≤ 3,000 chars) and contract diff hunks (≤ 1,500 chars) | Sends neither. Contract alerts carry paths and exported symbol names only; handoffs carry structured fields written by heuristics (see `PRIVACY.md` in Phase 8) |
| Handoff synthesis by an LLM on the hub when a key is present | Heuristic only in v1, no extra model calls, per the brief |
| Status line installed by `init-project` into project settings | Offered, with consent, as a user-settings change, because plugins cannot ship a status line (conflicts.md §3) |
| Windows untested | Windows CI job is a release blocker |
| Pillar A does not exist | Portability audit, fix, guard, manifest, setup, doctor and CI generator are half the product |

Relay's own prior-art table (`docs/research/prior-art.md` in its repo) also
compares Egregore (a git-backed team knowledge base), Entire CLI (session
transcript capture tied to commits) and TeamAI (distribution of skills and
hooks via a synced repo). None of them coordinates live work across
developers, which is the gap both Relay and Synchrobuilder target.

## 2. Anthropic's Agent Teams and cross-session messaging

**Agent Teams** orchestrates several Claude Code sessions on one machine
from one lead session: "Separate Claude Code instances that each work on
assigned tasks" (agent-teams.md L238). Everything is local to one user's
home directory (mailboxes under `~/.claude/teams/...`, tasks under
`~/.claude/tasks/...`, L242-L251), "One team per session ... You can't
create additional named teams or share a team across sessions" (L476), the
team config "is removed when the session ends" (L253), it is experimental
and off by default behind an environment flag (L9-L11, L54), and each
teammate is another Claude instance, so token cost scales with the team.

**Cross-session messaging** lets "one of your Claude Code sessions" message
"another" (cross-session-messaging.md L13). On one machine it uses files
and a per-user socket or named pipe ("two sessions can reach each other
only when they can see the same files", L166). Between machines it goes
"Through Anthropic servers, arriving over that machine's Remote Control
connection" (L159), which "needs a claude.ai sign-in as this session's
active authentication" (L342) and is single-account ("grants no one else
access", remote-control.md L200). Messages are plain text and ephemeral.

**How Synchrobuilder differs.** Agent Teams is one person orchestrating
Claude instances; cross-session messaging is one person's sessions talking.
Synchrobuilder is several people, each with their own Claude Code and their
own account or provider, on their own machines, sharing durable state
(presence, claims, tasks, handoffs) that outlives every session, through a
remote they already have, with no Anthropic-side relay. The two can
coexist: a developer can run an agent team locally while Synchrobuilder
tells their Claude what the human teammates are doing. We reuse one
convention from cross-session messaging: an incoming message is framed as
coming from another session, not from the user (agent-teams.md L108 quotes
the same rule for teammates), which is the model for our untrusted-teammate
wrapper in ADR-005.

## 3. What this means for the plan

- Build the client shape Relay proved (local cache, journal, outbox,
  background worker), without the hub, the shell wrapper or the bundle.
- Treat every Relay platform finding as a hypothesis to re-verify on our
  own CI, especially on Windows.
- Do not try to build on Agent Teams or cross-session messaging; they are
  the wrong shape and are account-bound. Mention both on the website's
  "How it works" page so nobody expects Synchrobuilder to replace them.
