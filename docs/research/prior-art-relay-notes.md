# Prior art: claude-code-relay (worklab-studio) — what Synchrobuilder can learn, reuse, and must re-verify

## Source

- https://github.com/worklab-studio/claude-code-relay — shallow clone at commit `e6f2957bbb8d79682c94bb0a42b53c693acfc8dc` (author date 2026-09-13), read on 2026-09-18 from the local clone under `scratchpad/relay/`. All citations below are `path:Lnn` in that clone.
- Claude Code docs referenced only for cross-checking: raw Markdown downloaded from code.claude.com/docs/en/<page>.md, fetch date 2026-09-18. These docs describe Claude Code up to v2.1.276 (latest on npm on 2026-09-18, per docs/research/README.md L10 in this repo); the local CLI used for experiments is v2.1.218 (`claude --version` on 2026-09-18).
- Everything Relay states about Claude Code is **their** claim. Such statements are labelled **Relay claims (unverified by us)** and must be re-tested on our machines before Synchrobuilder relies on them.

## 1. Purpose, license, language, requirements, platform support

- Purpose: "Two developers, two Claude Code sessions, one project. Relay makes each developer's Claude aware of what the other one is doing — automatically." (README.md L6). "It is a Claude Code plugin (hooks + MCP server) plus a small hub you host yourself." (README.md L10-11).
- License: MIT (README.md L226-228; LICENSE L1). Copyright line verbatim:
  > Copyright (c) 2026 Relay contributors
  (LICENSE L3). The notice must be reproduced in "all copies or substantial portions of the Software" (LICENSE L12-13).
- Language: TypeScript, pnpm monorepo (`packages/core`, `packages/hooks`, `packages/mcp`, `apps/api`), bundled with esbuild into two committed files `packages/plugin/dist/hook.mjs` and `dist/mcp.mjs` (README.md L212-216; DESIGN.md L110-111). Shell wrappers are POSIX `sh` (packages/plugin/scripts/hook.sh L1). Hub is Hono + Drizzle on Postgres/PGlite (README.md L216).
- Node/pnpm: build requires `"node": ">=20"` and `"packageManager": "pnpm@10.22.0"` (package.json L7-9); "Node ≥ 20 and pnpm 10 to build; the hook bundle itself must keep running on Node ≥ 18." (CONTRIBUTING.md L21). Developer machine: "Node ≥ 18 anywhere on disk." (README.md L145). Demo: "Requirements: macOS or Linux, Node ≥ 20, pnpm 10, git, Claude Code ≥ 2.1.224 (tested on 2.1.236)." (README.md L96-97).
- Platform statement, verbatim: "Windows is untested." (README.md L185). The plugin has no `package.json` (`ls -a packages/plugin`: `.claude-plugin/plugin.json .mcp.json dist hooks scripts skills team.json.example`; DESIGN.md L136 "The plugin directory contains no `package.json`, so Claude Code's plugin installer runs no `npm ci`").
- Status: "M0 — working end to end on one machine, verified against the real `claude` CLI." (README.md L172); interactive surfaces "not yet verified" (README.md L177-180).

## 2. Architecture and data flow

**Components** (DESIGN.md L78-87): plugin (`hooks.json`, `.mcp.json`, `team.json`, sh resolvers, `statusline.sh`, bundles, skills); hook bundle with verbs `session-start, prompt, pre-edit, pre-read, post-edit, post-git, task-created, task-completed, cwd, stop, session-end, mute, bg <job>` (L81); MCP server with 13 tools named `mcp__plugin_relay_relay__<tool>` (L82); hub on Vercel + Neon/PGlite (L84).

**Why a hub, not git** — Relay's design decision, verbatim (DESIGN.md L72):
> A git store (proposal 1) is 20–60 s behind and cannot deliver "actively editing" warnings inside that window; a per-developer daemon (proposal 3) adds a process lifecycle ... A single Hono function that returns the whole team snapshot on every response makes the latency-critical hooks (PreToolUse, UserPromptSubmit) local file reads, correct even while Vercel is down.

**Data flow** (README.md L60-70 diagram; DESIGN.md L43-48): hooks POST events to the hub; every hub response carries the whole team snapshot, written to `~/.relay/cache/<repoKey>/snapshot.json`; the edit-path and prompt-path hooks read only that cache; a detached background worker drains a write-ahead outbox. Human-visible surfaces are only the collision permission prompt and the status line (DESIGN.md L74).

**What leaves the machine** — verbatim (README.md L85-88):
> What leaves the machine: a derived objective (≤ 140 chars), repo-relative file paths, contract-file diff hunks (≤ 1,500 chars) and the code-stripped prose of Claude's replies (≤ 3,000 chars). Never prompts, source files or transcripts. All of it passes secret redaction first. The hub is your own deployment.

Full table DESIGN.md L883-895; honest summary L897: "file paths, contract-file diff hunks, and the prose of Claude's replies leave the machine; source files, prompts and transcripts do not." Knobs `privacy.send_prompts` (default false), `send_turns` (`"prose"`), `send_diffs` (`"contracts"`), `objective_from_prompts` (true) (packages/core/src/protocol.ts L381-394 `RELAY_CONFIG_DEFAULTS`; DESIGN.md L520). LLM handoff packet goes to the Anthropic API only when the hub has `ANTHROPIC_API_KEY` (DESIGN.md L894). Absolute cwd is sent repo-relative "the absolute checkout path (OS user name) stays on the machine" (packages/hooks/src/verbs/session-start.ts L217-218). The "code-stripped prose" is produced client-side by `packages/core/src/prose.ts`: fenced blocks (``` or ~~~ at any indentation, including an unterminated trailing one) removed, inline code > 80 chars removed, diff-shaped and stack-trace-shaped lines dropped (`DIFF_LINE`/`STACK_LINE` L9-11; markdown "- bullet" lines kept, L15-17), indented code blocks dropped (L25-28, L52), then capped at `LIMITS.turnTextChars` 3,000 (protocol.ts L175; prose.ts L1-4, L36-62). Prose runs before redaction (prose.ts L4).

**Redaction** (`packages/core/src/redact.ts`, 93 lines): a `PATTERNS` list (L10-26) covering private-key blocks, Relay `rt_` team tokens, AWS `AKIA`/`ASIA` ids, GitHub `ghp_/gho_/ghu_/ghs_/ghr_` and `github_pat_`, Slack `xox[abprs]-`, Stripe-style `sk|rk|pk_(live|test)_`, Anthropic `sk-ant-`, OpenAI `sk-`/`sk-proj-`, Google `AIza`, GitLab `glpat-`, npm `npm_`, JWT (`eyJ…`), Slack webhook URLs; then an `Authorization:` header family keeping the scheme (L29), an AWS secret-key label family (L40), a key=value family for `password|secret|token|api_key|…` with an ALL-CAPS/placeholder whitelist so `${VAR}`, `<placeholder>`, `process.env.X` are left alone (L35-43), URL userinfo passwords (L38), and finally a Shannon-entropy check (≥ 4.2 bits, mixed case + digit, ≥ 32 chars, not hex, not ULID) on base64-ish tokens (L45-65). `redactDeep` walks objects (L84-93). Applied to objectives at the source (packages/core/src/objective.ts L60-61).

## 3. Their hook design

**Events and wiring** (`packages/plugin/hooks/hooks.json`, 138 lines): SessionStart (no matcher, `timeout: 8`, `statusMessage`) L4-16; UserPromptSubmit `timeout: 5` L17-28; PreToolUse `"Edit|Write|MultiEdit|NotebookEdit"` `timeout: 3` L29-40 and `"Read"` via `guard-read.sh` `timeout: 2` L41-51; PostToolUse edit tools `"async": true` L53-64 and Bash with `"if": "Bash(git *)"` `"async": true` L65-76; TaskCreated/TaskCompleted `timeout: 2` L78-101; CwdChanged `timeout: 3` L102-113; Stop `"async": true` L114-125; SessionEnd (no timeout) L126-136. Every handler is exec form: `"command": "/bin/sh", "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/hook.sh", "<verb>"]`. Rationale (DESIGN.md L276): exec form "so `${CLAUDE_PLUGIN_ROOT}` substitutes without shell quoting and no exec bit is needed on cached files; `/bin/sh` is an absolute path because Desktop-launched sessions can have a minimal `PATH`"; "SessionStart has no matcher ... so all five sources fire — `startup|resume|clear|compact|fork`" (the five-source list is a Relay claim, unverified by us); "`async: true` only where no decision is needed".

**Internal deadlines** (packages/core/src/protocol.ts L91-105, `DEADLINE_MS`): session-start 3500, compact 800, prompt 2000, pre-edit 900, pre-read 600, post-edit/post-git 6000, task 300, cwd 1500, stop 5000, session-end 600, bg 15000 (ms). Budgets `BUDGET_MS`: sessionStartPost 3000, promptRefresh 800/1500, gitRevParse 300, gitGrep 2000 (protocol.ts L108-118). Measured (Relay claims): "session-start p50 197 ms / max 426 ms, prompt p50 8 ms, pre-edit p50 6 ms / max 26 ms" (docs/VERIFICATION.md L25) — these are in-process timings from `stats.jsonl` (`ms: rt.now() - rt.startedAt`, packages/hooks/src/main.ts L117), so they exclude Node start-up; DESIGN.md L454 puts pre-edit at "65 ms" typical including the spawn and README.md L203 says "A Node process spawn (~40 ms on a Mac) plus a file read."

**Why a shell wrapper** — verbatim comments (packages/plugin/scripts/hook.sh L3-12):
> POSIX sh: Desktop-launched sessions may have no login-shell PATH, so Node is resolved
> here (PATH, Homebrew, nvm, volta, fnm), verified once to be >= 18 (global fetch and
> AbortSignal.timeout) and cached in $RELAY_HOME/node-path. Every path this script
> controls exits 0 (fail open, §4.0 rule 2); a missing Node is a silent no-op.
> ...
> Claude Code exports NODE_USE_SYSTEM_CA=1 to its children. On Node 24.7 (macOS) that starts a keychain-reading
> thread at startup and process.exit() races it into a SIGSEGV (~20% of hook runs, reported by Claude Code as
> a hook error with exit code 1; seen in the real-claude verification). The hub is reached over plain http or
> a public CA; private CAs still work through NODE_EXTRA_CA_CERTS.
> unset NODE_USE_SYSTEM_CA

Node resolution order (hook.sh L20-37): `$RELAY_NODE` → cached `$RELAY_HOME/node-path` (only if owned by the current user, L15-18) → probe `node`, `/opt/homebrew/bin/node`, `/usr/local/bin/node`, nvm/volta/fnm globs sorted `-rV`, each checked with a one-line `node -e` major ≥ 18 test (L14); missing Node logs to `last-error` and `exit 0` (L38); then `exec "$N" --no-warnings "${CLAUDE_PLUGIN_ROOT:-$SELF/..}/dist/hook.mjs" "$@"` (L40). `mcp.sh` is identical except the bundle (mcp.sh L2-4, L38). `guard-read.sh` spawns Node only when `sessions/$CLAUDE_CODE_SESSION_ID/pending` is non-empty (guard-read.sh L5-8).

**Fail-open** (packages/hooks/src/main.ts): `process.on('uncaughtException'|'unhandledRejection', () => process.exit(0))` (L24-25); watchdog `setTimeout(() => process.exit(0), ms)` "not unref'd" armed before any work (L45-50); `main()` in try/catch/finally → `process.exit(0)` (L124-132); `RELAY_DISABLE=1` recursion guard (L86); stdout only `JSON.stringify(capOutput(out))` (L112), cap `hookStdoutChars: 9000` (protocol.ts L168, `LIMITS` L167-196). DESIGN.md L318: "Relay never calls `spawnSync`/`execSync`"; L319: "Exit 2 is never used (on `TaskCreated` it would even roll the task back)." — the roll-back parenthetical is a Relay claim (unverified by us).

**Journal / outbox / cache** (`packages/core/src/journal.ts` header L2-11): per-session dir `sessions/<sid>/` with `meta.json` (rewritten only under the lock), `events.jsonl` (append-only via `openSync(path,'a')` + `writeSync`, L109-130; one line ≤ 4 KB, rotated at 64 KB), `fold.json`, `marks/<kind>.<key>` created with `openSync(path,'wx')` so "exactly one of N parallel callers gets `created`" (L292-315; key = `sha1(path|dev)` L282-284), `.lock/` = `mkdirSync` with 50 ms spin, 300 ms give-up, 10 s stale recovery, then proceed lock-free (L420-458). Atomic writes = tmp + `renameSync` (packages/core/src/util.ts L152-158). Outbox = write-ahead log: `outbox/<ulid>.json` "written (tmp + rename) BEFORE every POST and deleted on 2xx"; drain oldest-first, cap 200, skip < 30 s, drop ephemeral > 24 h and everything > 7 d, poison entries dropped after `outboxMaxAttempts: 8` (outbox.ts L1-9, L106-125, L158-202). Snapshot cache written only if incoming `serverTime` ≥ cached (DESIGN.md L325); local file layout DESIGN.md L841-857. Circuit breaker: two consecutive worker failures → `down-until = now + 60 s`; 401/426/413 are configuration errors → 10-min breaker, body not enqueued (DESIGN.md L322).

**Collision verdicts** (`packages/core/src/collision.ts`; DESIGN.md L556-563): severity precedence `CLAIMED > HOT > WARM > SEQUENTIAL > SAME_DEV > NONE` (collision.ts L160-162). HOT = another dev's edit heat ≤ `heatHotMs` 15 min and their session seen ≤ `implicitClaimSeenMs` 30 min (L191-203; `STALENESS` protocol.ts L138-155); WARM = heat ≤ 24 h not yet in my branch by SHA/blob; SEQUENTIAL = already in my branch; SAME_DEV = my other session ≤ 10 min (L205-226). Default policy `{ hot: 'ask', claimed: 'ask', warm: 'context', same_dev: 'note' }` (protocol.ts L389). Staleness ladder: snapshot ≤ 5 min full policy; 5–15 min deny→ask, ask→context; > 15 min or breaker open → context only (DESIGN.md L569-574; `degradeForStaleness` collision.ts L127-131). In code the ladder applies to hard-claim `deny` too: "hard claims deny is still degraded: never deny on stale data" (collision.ts L292-295). Hard claims "block even under `bypassPermissions`" (DESIGN.md L382) — Relay claims (unverified by us).

**`ask` downgrade in non-interactive mode**: `if (decision === 'ask' && input.interactive === false) decision = 'context'` (collision.ts L298-301); interactive = not subagent (`agent_id` present), not `dontAsk`/`bypassPermissions`, not `RELAY_INTERACTIVE=0` (DESIGN.md L331), and — in code — `CLAUDE_CODE_ENTRYPOINT` must be absent, `cli` or `claude-desktop`; **any other value** (not only `sdk-cli`) is treated as headless (packages/hooks/src/session.ts L63-70; pre-edit.ts L101), added after the experiment found "`permission_mode` in stdin was `acceptEdits`, not `dontAsk`, for the plain headless run" (docs/research/experiments.md L128-133). Reason: in `-p` "`ask` becomes a denial whose reason is the tool error" (experiments.md L50).

**Once-per-file throttle**: "one `ask` per `(path, other dev)` per 30 min per session — `marks/asked.<key>` is created synchronously *before* the prompt and turned into `marks/snooze.<key>` by the landing edit (§4.5) ... an `asked` mark with no edit behind it expires after 2 min" (DESIGN.md L565); constants `askedExpiryMs: 120_000`, `snoozeMs: 1_800_000` (protocol.ts L152-155); code path pre-edit.ts L119-129 (`renewMark(... 'asked' ...)`), WARM/SEQUENTIAL/SAME_DEV notes once per session via `noted` marks (collision.ts L317-323). The hook "cannot observe the user's answer; the *edit landing* is the signal" (DESIGN.md L381).

**Digest**: rendered by the hub, "≤ 6,000 chars; ≤ 2,000 chars in `delta` mode" (DESIGN.md L738), `LIMITS.digestChars: 6000`, `deltaDigestChars: 2000`, `compactReinjectChars: 1500` (protocol.ts L171-173); format is a `<relay-digest team= project= repo= dev= at= freshness= since= mode=>` block with sections `## Team now`, `## Contract changes affecting you`, `## Messages for you`, `## Handoffs since your last session`, `## Decisions (last 5)`, `## Your last handoff → next`, `## Relay` (DESIGN.md L741-765); "every line carries an absolute timestamp (mid-session hook context is replayed from the transcript on `--resume`)" (L768; the replay-on-resume behaviour is a Relay claim, unverified by us); client-side hard cap `digest.slice(0, LIMITS.digestChars + 600)` (session-start.ts L263). Compact: no network, re-injection from cache (session-start.ts L173-185). Delivered as `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext": …, "sessionTitle": …}}` (session-start.ts L269), `sessionTitle` only on startup/resume/fork and never overwriting a user's `/rename` title (L119-127, L267-268).

**Handoff heuristic** (`packages/hooks/src/handoff-draft.ts`): built from the fold at every Stop, ≤ 8 KB (L1-5; `draftBytes: 8192` protocol.ts L178). Signals: `done` = completed task subjects + sentences of the last two turns matching `DONE_RE = /^(Done|I've|I have|Added|Updated|Fixed|Implemented|Removed|Renamed|Migrated|Committed|Created|Wrote|Refactored|Moved|Deleted|Replaced|Extracted)\b/` (L22, L105-110); `decisions` = `/\b(decided|decision|we'll go with|going with|chose|settled on|instead of)\b/i` (L23); `blockers` = `/\b(blocked|blocker|waiting on|can't proceed|cannot|need [^.]* from)\b/i` (L24); `next` = bullets under a `Next`/`TODO`/`Remaining` heading in the last turn, ≤ 5 (L25-27, L41-60); `changed` from fold edits + files changed outside Claude; `interfaces_changed` from open contract records; trivial sessions (0 edits, 0 commits, < 3 prompts) get none (L62-65). LLM tier is hub-side and optional (DESIGN.md L669; docs/DECISIONS.md L6-9).

**Objective derivation** (`packages/core/src/objective.ts`): task subject > prompt heuristic > branch (L2-3, L111-122). Prompt candidate = first line with fences, URLs, `@mentions`, paths, long inline code stripped (L20-37); rejected if `< 25` chars, matches the stoplist (L11), ≥ 40 % non-alphabetic, starts with `/` or `[private]`, or `< 60` chars after a question (L52-60); truncated to `objectiveChars: 140` (L61; protocol.ts L177); replaced when imperative verb/pivot word (L12-14, L95-104) or after 10 min / 15 tool calls (L16-17). Branch humanised `feat/dashboard-filters` → `dashboard filters` (L64-73).

**Area mapping** (`packages/core/src/area.ts`; `.relay.json` schema DESIGN.md L502-523): recency-weighted vote `3 / (1 + minutesAgo / 10)` over the last 20 edited paths (L52-56, L66-75); `shared: true` areas are ranked separately and never outrank a non-shared area; they are appended to the display as `app (+contracts)` (L76-85); ties or no non-shared edits fall through branch token → owner → cwd segment (L93-110); if *only* shared areas were edited the top shared area is used (L111-112); else `unknown` (L113). `.relay.json` is JSONC with defaults applied by `resolveRelayConfig` (config.ts L103-149, L165-218).

**Identity** (`packages/core/src/identity.ts` L69-121): `RELAY_DEV` env → `identity.json` written by `/relay:iam` (source `identity-file`) → a cached non-placeholder evaluation reused for 24 h while the git email is unchanged (L87-92) → `git config user.email` matched case-insensitively against `team.json.members[*].emails` → GitHub noreply `<id>+<login>@users.noreply.github.com` vs `members[*].github` → email local part == handle → `$USER` == handle → per-machine placeholder `unknown-<sha1(hostname+user).slice(0,6)>` (L41-44). `team.json` lives in the plugin root (`${CLAUDE_PLUGIN_ROOT}/team.json`, config.ts L221-226; fallback: `RELAY_HUB` + `RELAY_TOKEN` env build a member-less team, L227-228), shape `{hub, team, token, marketplace, members:{handle:{name, emails[], github}}}` (packages/plugin/team.json.example L1-10). Relay claims (unverified by us): "No env var carries the email into hooks/MCP subprocesses." (docs/research/platform.md L14).

**Mute** (`packages/core/src/mute.ts`; skills/mute/SKILL.md): `/relay:mute <path|glob|area|@dev> [--undo]` runs `/bin/sh "${CLAUDE_PLUGIN_ROOT}/scripts/hook.sh" mute $ARGUMENTS` (SKILL.md L18), writes `~/.relay/mute/<repoKey>.json` `{v:1, targets:[{target, kind, at}]}` (mute.ts L33-39), "never committed and never reach the hub" (SKILL.md L23-24); muted verdicts return NONE with downgrade `muted` (collision.ts L253-257).

**Status line**: not shipped by the plugin. Relay claims (unverified by us): "plugins cannot ship one: a plugin `settings.json` supports only `agent` and `subagentStatusLine`" (DESIGN.md L465; docs/research/plugins-mcp.md L93) — yet their own platform notes say "Plugins can ship a default `statusLine`/`subagentStatusLine`." (docs/research/platform.md L213). Their `init-project` writes a project `statusLine` `{"type":"command","command":"/bin/sh -c 'f=\"${RELAY_HOME:-$HOME/.relay}/statusline.sh\"; [ -r \"$f\" ] && exec /bin/sh \"$f\" || true'","refreshInterval":10}` (DESIGN.md L180). `statusline.sh` (POSIX sh + sed, "~5 ms, no Node") finds `current/<CLAUDE_PID>.json`, reads a pre-rendered `statusline.txt`, chains the user's own status line first, prints `relay ○` when nothing is known (packages/plugin/scripts/statusline.sh L1-40). Renderer: `relay ● <dev> <area> <branch> <HH:MM|state HH:MM> · … · N impacts · N notes`, at most 4 devs, absolute times (packages/core/src/notes.ts L261-286).

**Seats**: nothing named "seats" exists in the client or protocol; the only "seat" is the Vercel Pro plan note ("one seat, ≈ $20/month", DESIGN.md L192). Presence is per Claude session, one record per session, dev-level = union of sessions (DESIGN.md L533).

**Background worker**: `spawn(process.execPath, ['--no-warnings', bundlePath, 'bg', job, ...args], { detached: true, stdio: 'ignore', env: {...rawEnv, RELAY_BG: '1'}, windowsHide: true })` + `child.unref()` (packages/hooks/src/runtime.ts L164-171); single-flight `mkdir` lock per job/repo, 15 s watchdog (DESIGN.md L469).

**MCP server**: `.mcp.json` `{"mcpServers":{"relay":{"type":"stdio","command":"/bin/sh","args":["${CLAUDE_PLUGIN_ROOT}/scripts/mcp.sh"]}}}` (packages/plugin/.mcp.json L1-9). Relay claims (unverified by us): `CLAUDE_CODE_SESSION_ID` is frozen at spawn for a stdio server, so the live session is resolved per call via `current/<process.ppid>.json` (DESIGN.md L714; platform.md L320); Claude Code "spawned the stdio server twice at startup" and sends SIGINT at teardown (experiments.md L193-196).

## 4. Experiments and verification claims Synchrobuilder must re-verify

All rows: Relay's evidence is CLI 2.1.236 headless (`claude -p`) on one Mac, node v24.7.0 (experiments.md L3); our status for every row is **not yet verified**.

| # | Relay claim (unverified by us) | Their evidence | Where |
|---|---|---|---|
| 1 | Plugin from a settings-file marketplace becomes live only on the **third** session: register → cache → load | debug log lines per session; "No hooks fired, tool absent" in sessions 1–2 | experiments.md L69-85, L97-100 |
| 2 | Install record is **per project folder** (`installed_plugins.json … scope: project, projectPath`); a second clone needs its own sessions | second clone logged `plugin-cache-miss` although the cache existed | VERIFICATION.md L15; experiments.md L257-259 |
| 3 | `claude plugin marketplace add file:///…/mkt.git` is rejected; a working-tree dir registers a `directory` source, runs in place, and rewrites project settings | CLI error strings | experiments.md L86-92 |
| 4 | `hasTrustDialogAccepted: true` in `~/.claude.json` does not run the headless installer; only `--settings` did | observed | experiments.md L259-262 |
| 5 | Both permission rule forms `mcp__plugin_<p>_<s>` and `mcp__plugin_<p>_<s>__*` suppress prompts | 0 `permission_denials`; control rule denied | experiments.md L106-115 |
| 6 | In `-p`, `permissionDecision: "ask"` becomes a denial with the reason as tool error; `additionalContext` still delivered; same in subagents/`dontAsk`; hook env carries `CLAUDE_CODE_ENTRYPOINT=sdk-cli` | stream-json `permission_denied` events | experiments.md L119-133, L275-278 |
| 7 | Async PostToolUse `additionalContext` reaches Claude on the **next model request** (same turn); 0 hook errors in 10 runs; 3 parallel Reads → 3 distinct `tool_use_id`s | stream-json | experiments.md L138-145 |
| 8 | Async **Stop hook is cancelled at `-p` teardown** (~200 ms after registration); completes in a multi-turn `--input-format stream-json` session | debug log `cancelled`, `exit_code: 1` | experiments.md L141-143, L179-181, L279-280; VERIFICATION.md L38-40 |
| 9 | SessionEnd hook sleeping 2.5 s is cancelled at 1.5 s; detached workers (`detached:true, stdio:'ignore', unref()`) survive teardown and finish 4 s after exit | log lines with `ppid: 1` | experiments.md L59, L176-184 |
| 10 | 5,977-char SessionStart `additionalContext` delivered inline, no file spill; `sessionTitle` honoured on startup/resume/fork; fork gets a new `session_id` | debug `provided additionalContext (5977 chars)` | experiments.md L52, L149-155 |
| 11 | SessionStart stdin has **no `permission_mode`, no `model`** on 2.1.236 headless; SessionEnd `reason: "other"` for `-p` | stdin capture | experiments.md L156-158 |
| 12 | `if: "Bash(git *)"` fires for `git add -A && git commit …`, not for `pnpm --version` | control hook without `if` | experiments.md L53, L162-163 |
| 13 | `TaskCreated`/`TaskCompleted` carry `task_id, task_subject, task_description`; `prompt_id` on Stop/SessionEnd/etc.; `CLAUDE_ENV_FILE` only on SessionStart; exports visible to later Bash | stdin capture; `printenv` | experiments.md L54-55, L164-170 |
| 14 | `systemMessage` on UserPromptSubmit becomes a stream `system/informational` event with prefix `"<event> says: "`; not Claude context | stream-json | experiments.md L56, L225-231 |
| 15 | `${CLAUDE_PLUGIN_ROOT}` substitutes in exec-form `args` for hooks and `.mcp.json`; cache dir basename is `plugin.json.version` or `unknown`, **not** the commit SHA; SHA is `gitCommitSha` in `installed_plugins.json` | paths observed | experiments.md L57, L210-221 |
| 16 | MCP server `ppid` == Claude PID == hooks' `CLAUDE_PID`; server env lacks `CLAUDE_PID`; server spawned twice; SIGINT at teardown | pid logs | experiments.md L58, L188-196 |
| 17 | Hook env in `-p`: `CLAUDE_PLUGIN_ROOT, CLAUDE_PLUGIN_DATA, CLAUDE_PROJECT_DIR, CLAUDE_CODE_ENTRYPOINT, CLAUDE_PID, CLAUDE_CODE_SESSION_ID, CLAUDECODE=1, CLAUDE_CODE_CHILD_SESSION=1` | env capture | experiments.md L197-201 |
| 18 | **Desktop** session on their Mac (Desktop-bundled binary 2.1.260, not the 2.1.236 CLI used for the runs) had `CLAUDE_CODE_ENTRYPOINT=claude-desktop`, `CLAUDE_PID`, `CLAUDE_CODE_CHILD_SESSION=1`, `DISABLE_AUTOUPDATER=1` and a full login-shell PATH; minimal-PATH machines and SessionEnd on tab close untested | env of the session that ran the experiments | experiments.md L202-206 |
| 19 | **`NODE_USE_SYSTEM_CA=1` + Node 24.7.0 (macOS) → SIGSEGV on `process.exit()`** in 8/40 pre-edit runs, 1/40 `node -e 'process.exit(0)'`, 0/40 unset, 0/40 on Node 22.19; Claude Code reports `exit_code: 1, outcome: "error"` but still honours stdout JSON | crash reports in `~/Library/Logs/DiagnosticReports` | experiments.md L268-274; VERIFICATION.md L27-30 |
| 20 | Claude Code's own `ListAgents`/`SendMessage` let one session "interrogate" a peer session and pollute it; they disabled those tools in tests | observed | experiments.md L281-283 |
| 21 | Timings: session-start p50 197 / max 426 ms, prompt p50 8 ms, pre-edit p50 6 / max 26 ms, post-edit ≤ 141 ms, stop ≤ 172 ms, session-end ≤ 13 ms (in-process, excludes spawn) | `log/stats.jsonl` | VERIFICATION.md L25; experiments.md L265-267 |
| 22 | Interactive-only, **never observed by them**: trust-dialog install flow, collision `ask` prompt UI, `/reload-plugins`, `/cd` → CwdChanged, status line rendering, `/exit` reason `prompt_input_exit`, Desktop lifecycle | — | VERIFICATION.md L32-38; README.md L177-180 |

## 5. Their prior-art comparison

README.md L155-164 compares Relay against:
- **Egregore** (github.com/egregore-labs/egregore) — "A second git repo (`memory/`, symlinked into the instance repo) holds markdown handoffs/decisions/people; hooks sync it and render a greeting" (docs/research/prior-art.md L16); bash + jq, optional Neo4j (L5); shared team memory yes, live presence = activity log, manual `/handoff` (README.md L157-163). Their hook table: prior-art.md L79-93; latency 40–60 ms light hooks, heavy SessionStart (L21, L309-315).
- **Entire CLI** (github.com/entireio/cli) — Go binary; "Every Claude Code turn is snapshotted (transcript + touched files) onto a shadow git branch; when the user commits, it is condensed into a checkpoint ref linked to the commit" (prior-art.md L16); session capture, no presence/claims (README.md L158-161); hook wiring via `sh -c '… exec entire hooks claude-code <verb>'` (prior-art.md L389-398).
- **TeamAI** (github.com/Tencent/teamai-cli) — distributes skills/rules/hooks to a team (README.md L159); Relay's non-goal table says the native plugin marketplace already does this (DESIGN.md L19).
- **Claude Code Agent Teams** — "single user", "experimental flag", scoped to one account and one machine (README.md L155-164; DESIGN.md L20).

Their lesson: "both tools converge on *git as the sync bus* and *hooks as the capture point* ... Neither has a live/team-presence or file-ownership layer; that gap is real." (prior-art.md L23). Primitives they recommend reusing: Egregore's `observe.sh` event shape `{ts,tool,path}`, "Entire's one-ref-per-object pattern for conflict-free shared state over git", "Egregore's WAL + drain for anything that talks to a network from a hook", Entire's ~100 words of injected context vs Egregore's 10–15k tokens (prior-art.md L517-526).

## 6. What to reuse, what needs a notice, what to avoid

**Reuse as ideas (credit "claude-code-relay, MIT")**: crash-guard-then-watchdog-then-`exit 0` entry shape (main.ts L24-50, L124-132); `wx` marker files for race-free once-only delivery and the `asked → snooze` promotion driven by the landing edit (journal.ts L292-315; DESIGN.md L565); write-ahead outbox before every network call (outbox.ts L1-9); snapshot write guarded by `serverTime` (DESIGN.md L325); staleness ladder that never blocks on stale data (collision.ts L126-131); same-clock age arithmetic (DESIGN.md L333); author-filtered git attribution (DESIGN.md L324); factual, timestamped context phrasing (DESIGN.md L332); compact-source re-injection (session-start.ts L173-185); per-machine placeholder identity (identity.ts L41-44); `[private]` prompt prefix (objective.ts L54); JSONC config loader (config.ts L184-218); `statusline.txt` pre-rendered by the writer so the status-line command is a file read (notes.ts L263-286); recorded hook-input fixtures replayed through the real bundle (scripts/smoke/README.md L1-9).

**Must not copy verbatim without the MIT notice**: `redact.ts` pattern list and entropy check; `prose.ts` regexes; `handoff-draft.ts` regexes; `objective.ts` stoplist/imperative lists; `collision.ts`; `journal.ts` mark/lock helpers; `scripts/smoke/*.json`. LICENSE L12-13 requires the copyright and permission notice in "all copies or substantial portions".

**Avoid**: the hosted hub (DESIGN.md L53-65) and shared team token in the plugin repo where "teammates could impersonate each other" (DESIGN.md L213; DECISIONS.md L10-12); `/bin/sh` wrappers and `NODE_USE_SYSTEM_CA` unsetting (hook.sh L7-12) — the brief forbids shell; LLM handoff synthesis on a server with an API key (DESIGN.md L669-672); the prose of assistant turns leaving the machine (DESIGN.md L890, L897); Windows gaps (`ls`/`sort -rV`/`$HOME/.nvm` probes in hook.sh L29-31; `/bin/sh` absolute paths in hooks.json; README.md L185); the 8-second SessionStart timeout with a 3 s synchronous network POST (hooks.json L11; session-start.ts L232-233); the `ListAgents`/`SendMessage` pollution risk they hit (experiments.md L281-283).

## 7. Recorded hook inputs in `scripts/smoke/` (MIT-licensed fixtures)

Files and events (scripts/smoke/*.json): `cwd.json` (CwdChanged), `post-edit.json` (PostToolUse Edit with `tool_response`), `post-git.json` (PostToolUse Bash `git add -A && git commit`), `pre-edit.json` (PreToolUse Edit), `pre-edit-write.json` (PreToolUse Write), `pre-read.json` (PreToolUse Read), `prompt.json` (UserPromptSubmit), `session-end.json` (SessionEnd `reason: "prompt_input_exit"`), `session-start.json` (startup), `session-start-resume.json` (resume with `seconds_since_last_response`, `context_tokens`, `prompt_cache_likely_expired`, `estimated_cache_write_usd`), `session-start-compact.json` (compact), `stop.json` (Stop with `last_assistant_message`, `background_tasks`, `session_crons`, `effort`), `task-created.json`, `task-completed.json`. Shape `{ verb, env, stdin, expect }`; "`stdin` is a realistic Claude Code 2.1.236 payload per docs/research/hooks.md" — i.e. hand-written to their notes, not raw captures (scripts/smoke/README.md L3-4). Placeholders `{{REPO}}`, `{{HOME}}`, `{{SESSION}}`, `{{HUB}}` (README.md L6-8).

`scripts/smoke/pre-edit.json` (verbatim):

```json
{
  "verb": "pre-edit",
  "env": {},
  "stdin": {
    "session_id": "{{SESSION}}",
    "transcript_path": "{{HOME}}/transcript.jsonl",
    "cwd": "{{REPO}}",
    "hook_event_name": "PreToolUse",
    "tool_name": "Edit",
    "tool_input": {
      "file_path": "{{REPO}}/packages/contracts/src/billing.ts",
      "old_string": "total: number",
      "new_string": "amountDue: number",
      "replace_all": false
    },
    "tool_use_id": "toolu_01ABC123",
    "prompt_id": "550e8400-e29b-41d4-a716-446655440000",
    "permission_mode": "acceptEdits",
    "effort": {
      "level": "high"
    }
  },
  "expect": {
    "exit": 0,
    "stdout": "json",
    "hookEventName": "PreToolUse",
    "permissionDecision": "ask",
    "maxMs": 900
  }
}
```

`scripts/smoke/session-start.json` (verbatim):

```json
{
  "verb": "session-start",
  "env": {},
  "stdin": {
    "session_id": "{{SESSION}}",
    "transcript_path": "{{HOME}}/transcript.jsonl",
    "cwd": "{{REPO}}",
    "hook_event_name": "SessionStart",
    "source": "startup",
    "model": "claude-opus-5"
  },
  "expect": {
    "exit": 0,
    "stdout": "json",
    "hookEventName": "SessionStart",
    "maxMs": 3500
  }
}
```

Note: `model` in this fixture contradicts their own experiment finding "no `permission_mode`, no `model`" on SessionStart stdin (experiments.md L156-157); treat the fixtures as their approximation, not ground truth.

## Implications for Synchrobuilder

1. **Pillar B is the same problem Relay solved, minus the hub.** Relay's rejection of git as the transport (DESIGN.md L72, "20–60 s behind") is exactly the trade-off the brief accepts (30–60 s sync loop). Synchrobuilder should present collision warnings as "edited by X within the last N minutes as of HH:MMZ", never as "editing right now", and should adopt Relay's staleness ladder so a stale snapshot only ever produces context, never `ask`.
2. **Hook budget.** Relay's 6 ms pre-edit is in-process; with the Node spawn the design's own figure is ~65 ms (DESIGN.md L454) and README says the spawn alone is ~40 ms (L203). The brief's "< 50 ms" for pre-edit/prompt hooks therefore hinges on Node start-up on the target machines; measure `node -e 0` and the bundle load before committing to the number, keep the bundle zero-dependency and small (Relay's hook bundle ≈ 60 KB, DESIGN.md L110), and do no `require` of anything beyond `node:*`.
3. **No shell wrapper means two problems Relay solved in `hook.sh` land on us**: Node discovery when Desktop launches Claude with a minimal PATH, and the `NODE_USE_SYSTEM_CA` SIGSEGV on Node 24.7. Invoking `node "<path>"` directly relies on `node` being on the hook process's PATH; the crash can only be avoided by not calling `process.exit()` early, by clearing the variable inside the process before any TLS/keychain work (if that is even effective), or by documenting a Node version. Both are Phase-0 experiments.
4. **Fail-open pattern** (main.ts L24-50) is directly adoptable in `.mjs`: uncaught handlers → exit 0, un-unref'd watchdog, single JSON on stdout, stats line locally.
5. **Once-per-file-per-30-min** can be done with `wx` marker files; note Relay's nuance that the snooze starts only when the edit lands and an unanswered `ask` re-arms after 2 min — Synchrobuilder's brief says "at most once per file per 30 min", so start the 30-min window at the ask, not at the edit.
6. **Digest**: 6,000 chars matches the brief's ~6 KB; Relay claims 5,977 chars arrive inline (experiments.md L154-155). Keep absolute timestamps (replay on resume) and a compact-source re-injection.
7. **Handoff without an LLM** is feasible: Relay's tier-1 regexes (handoff-draft.ts L22-27) plus completed task subjects give done/decisions/blockers/next. Reading `last_assistant_message` at Stop is the only source of prose — but the brief forbids sending transcripts; the extracted lines would go to the orphan branch, so decide whether prose-derived lines are acceptable (Relay made this a per-repo knob, DESIGN.md L890).
8. **Identity**: Relay's ladder (identity.ts L69-121) maps 1:1 onto `.synchrobuilder/team.json` + `/synchrobuilder:iam`; keep the per-machine placeholder so two unknown users never merge.
9. **Untrusted teammate text**: Relay does not label digest text as untrusted (it relies on factual phrasing, DESIGN.md L332). Synchrobuilder's labelled block is stricter; still adopt "no imperatives" inside the block.
10. **Status line**: Relay writes a project-scope `statusLine` from an init command and pre-renders the line to a file so the command is a ~5 ms read (statusline.sh). If docs confirm a plugin-shipped `statusLine`, ship it; otherwise `/synchrobuilder:init` would have to write project settings with consent (brief: consent before changing a machine).
11. **Install/marketplace**: Relay claims a settings-file marketplace needs up to three sessions and a per-project install record (experiments.md L97-100, L257-259). Our install path is `/plugin marketplace add` + `/plugin install`; verify how many sessions until hooks are live and whether the record is per project.
12. **Testing**: replaying recorded stdin fixtures through the real bundle with p95 gates and parallel-hook cases (scripts/smoke/run.mjs L2-14) is the right harness shape for `/synchrobuilder:ci`.
13. **MCP**: Relay needed an MCP server for on-demand tools and `/relay:*` skills call those tools. Synchrobuilder's commands can be plain skills/commands calling `node` scripts; `.mcp.json` remains optional, consistent with the brief.

## Conflicts with the brief

| Brief says | Relay says / evidence | Citation |
|---|---|---|
| Hooks before edits and on every prompt are local-file-read only and under 50 ms | Relay's prompt hook does a synchronous `GET /v1/snapshot` (800–1,500 ms budget) when the cache is > 60 s old, and pre-edit is ~65 ms typical with the Node spawn; only in-process time is 6 ms | DESIGN.md L361, L365, L454; README.md L203; VERIFICATION.md L25 |
| No bash/PowerShell/cmd anywhere in shipped code | Relay routes every hook and the MCP server through `/bin/sh` wrappers specifically for Desktop minimal PATH and to unset `NODE_USE_SYSTEM_CA` (SIGSEGV on Node 24.7) | hook.sh L3-12; hooks.json L9-10; DESIGN.md L276 |
| Transport = orphan branch on git remote, sync every 30–60 s | Relay rejected a git store as "20–60 s behind and cannot deliver 'actively editing' warnings inside that window" | DESIGN.md L72 |
| Status line shows presence if plugins can drive it | Relay: "plugins cannot ship one" (plugin settings.json supports only `agent`, `subagentStatusLine`) vs. their platform note "Plugins can ship a default `statusLine`" — contradictory; they shipped it via project settings | DESIGN.md L465; plugins-mcp.md L93; platform.md L213 |
| Collision warn/ask at most once per file per 30 min | Relay: `asked` mark expires after 2 min if no edit lands (denied ask can re-prompt after 2 min); snooze of 30 min starts at the landing edit | DESIGN.md L565; protocol.ts L152-155 |
| Notify lands in the next prompt, sooner if plugin monitors allow | Relay claims a standard MCP server cannot push; Channels require `--dangerously-load-development-channels`; delivery is next prompt / next tool call / async PostToolUse next turn | platform.md L86-87, L94; DESIGN.md L22, L643 |
| Install via `/plugin marketplace add <owner>/<repo>` then `/plugin install` | Relay never used that path; they used `.claude/settings.json` `extraKnownMarketplaces` + trust dialog, and headless `--settings`; CLI `marketplace add file://…` was rejected | DESIGN.md L177-178, L197; experiments.md L86-92, L252-262 |
| Handoff written at session end (no LLM, no server) | Relay's SessionEnd only writes a WAL entry and forks a detached worker because SessionEnd has a 1.5 s shared budget (their claim); handoff is finished on the hub, optionally by Haiku | DESIGN.md L439-445; experiments.md L178-184; DECISIONS.md L6-9 |
| Privacy: never send prompts, transcripts, source contents | Relay sends contract diff hunks (≤ 1,500 chars) and prose of assistant replies (≤ 3,000 chars) by default | README.md L85-88; DESIGN.md L889-890 |
| Shorter command prefix / aliases (e.g. `/sb:audit`) | Relay's commands are `/relay:<skill>` — namespaced by the `plugin.json` `name`; no evidence of aliases or a separate prefix | packages/plugin/.claude-plugin/plugin.json L3; DESIGN.md L112, L736 |
| Hooks read only a local snapshot cache | Relay's SessionStart POSTs synchronously (3 s budget) and prompt refreshes synchronously; only PreToolUse is cache-only | DESIGN.md L322, L342-344, L361, L373 |

## Open questions (need an experiment on a real machine)

1. Does `node` resolve on PATH in a Desktop-launched Claude Code session on a fresh macOS/Windows account, without a login-shell PATH? (Relay's only Desktop evidence had a full PATH: experiments.md L202-206.)
2. Does `NODE_USE_SYSTEM_CA=1` reach hook processes on v2.1.218 and v2.1.276, and does the SIGSEGV reproduce on current Node 24.x when the hook is invoked as `node "<path>"` with no wrapper? Can the `.mjs` mitigate it (avoid early `process.exit`, `delete process.env.NODE_USE_SYSTEM_CA` at top)?
3. Wall-clock cost of `node hook.mjs` (spawn + bundle load + JSON read) on the target machines — is < 50 ms achievable?
4. Can a plugin ship a `statusLine` (plugin `settings.json`)? Relay's notes contradict each other (DESIGN.md L465 vs platform.md L213).
5. In interactive sessions, does `permissionDecision: "ask"` with `permissionDecisionReason` show the reason, force a prompt under `acceptEdits`/`auto`, and is it bypassed by an "always allow" rule? (Relay: never observed, VERIFICATION.md L32-36.)
6. In `-p`/CI, does `ask` become a hard denial (Relay claims yes, experiments.md L119-122)? Synchrobuilder's `/synchrobuilder:ci` must then never emit `ask`.
7. How many sessions after `/plugin install` until hooks fire, and is the install record per project folder? (Relay: three sessions and `projectPath` scope via settings-file installs.)
8. Is an async Stop hook cancelled at `-p` teardown and does SessionEnd get 1.5 s total (Relay claims both)? Determines whether the handoff must be written by a detached process — which the brief's "no server, Node-only" allows but the fail-open rule complicates.
9. Does SessionStart `additionalContext` of ~6,000 chars arrive inline and survive `--resume` replay; is `sessionTitle` honoured?
10. Does hook `cwd` follow worktrees while `CLAUDE_PROJECT_DIR` does not (Relay claims: DESIGN.md L324; hooks.md L603)?
11. Windows: are hook `file_path`s backslashed, is `Bash` present, and do exec-form `args` with `${CLAUDE_PLUGIN_ROOT}` substitute? (Relay: untested, README.md L185; hooks.md L601.)
12. Is `CLAUDE_CODE_SESSION_ID` really frozen for a stdio MCP server after `/clear` (only relevant if Synchrobuilder ships `.mcp.json`)?
13. Do `ListAgents`/`SendMessage` in a teammate's session interfere with Synchrobuilder's own delivery (Relay saw a session "polluted", experiments.md L281-283)?
