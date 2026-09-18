# Synchrobuilder — plan

Status: Phase 0 complete, awaiting the owner's approval before any product
code is written. Date: 2026-09-18.

One-sentence pitch: Multiplayer Claude Code for teams on any laptop. No
server, safe by design.

## 0. What Phase 0 produced and what you are approving

- `docs/research/`: line-cited notes from the official docs (fetched
  2026-09-18, describing Claude Code v2.1.276; local CLI v2.1.218), each
  checked by an independent verifier; `experiments.md` with everything we
  actually ran; `conflicts.md`; `prior-art.md`.
- `docs/adr/`: ADR-001 transport, ADR-002 identity, ADR-003 hook language
  and packaging, ADR-004 manifest format, ADR-005 teammate-message security,
  ADR-006 website stack. All are "Proposed" until you approve.
- This plan: phases, tasks, acceptance criteria, risks, and the open
  questions in section 8 that need your answers.

Approving this plan means approving the changes to the brief in section 1.

## 1. Changes to the brief that the docs force (details in `docs/research/conflicts.md`)

1. **Layout.** One source tree inside `plugins/synchrobuilder/`; no
   `packages/*`, no `dist/`, no bundler. A plugin cannot reference files
   outside its directory and files above it are not copied on install
   (ADR-003).
2. **Skills, not commands.** Every slash command is `skills/<name>/SKILL.md`
   with `disable-model-invocation: true` where it is user-only. `commands/`
   is the legacy layout.
3. **Status line.** A plugin cannot ship a status line. We offer to install
   one into the user's own settings, with consent, and show presence in
   `/synchrobuilder:status` regardless.
4. **Monitors are optional.** They are experimental, interactive-only and
   disabled by telemetry opt-outs. The baseline is hooks plus a background
   worker; a monitor only makes delivery faster where it exists.
5. **Handoff timing.** SessionEnd gives plugin hooks 1.5 s, so the handoff
   is staged on every `Stop` and finalized by the worker.
6. **Naming.** No alias or shorter prefix exists (section 2).
7. **Ask vs warn.** Collision "ask" is opt-in per team and automatically
   downgraded to "warn" in `dontAsk`, `bypassPermissions` and headless
   runs, where "ask" would mean "deny".
8. **Transport shape.** One ref per developer and device
   (`refs/synchrobuilder/v1/<handle>/<device>`) holding a parentless
   snapshot commit, instead of one shared orphan branch: no merges, no
   read-before-write, a hostile or buggy teammate cannot block anyone
   (ADR-001). All plugin state lives under `~/.synchrobuilder/`, never
   inside the user's `.git`.

## 2. Naming: the answer to the `/sb:audit` question

The prefix is always the manifest `name`; there is no alias mechanism
(plugins-reference, skills, commands pages, all searched). Two things help:

- The bare last segment works when no other command owns it: `/audit`,
  `/fix`, `/setup`, `/ci`, `/claim`, `/release`, `/notify`, `/handoff`,
  `/iam`, `/mute`, `/board` invoke our skills directly. `/init`, `/doctor`
  and `/status` are owned by Claude Code, so those three need the full
  `/synchrobuilder:` form (or a rename; see open question 1).
- Since v2.1.236 the menu highlights `/synchrobuilder:audit` when you type
  `/audit`, so Enter gets you there even when the bare form is ambiguous.

Recommendation: keep `synchrobuilder`, keep every command one short word.
Renaming the plugin to `sb` is the only way to get a literal `/sb:` prefix;
we advise against it (the install id and name are immutable after release).

## 3. Repository layout (proposed, replaces section 4 of the brief)

```
.claude-plugin/marketplace.json      name "synchrobuilder"; one plugin entry, source "./plugins/synchrobuilder"
plugins/synchrobuilder/
  .claude-plugin/plugin.json         name, displayName, explicit semver version
  package.json                       name "synchrobuilder", "bin", no dependencies, no lockfile
  bin/synchrobuilder.mjs             npx synchrobuilder <audit|fix|init|setup|doctor|ci|...>
  hooks/hooks.json                   exec-form node hooks only
  hooks/run.mjs                      single dispatcher
  lib/                               config, identity, paths, git plumbing, cache, redaction, rules/*, transport/*, seats
  skills/<name>/SKILL.md             one per command
  monitors/monitors.json             optional (Phase 6 experiment)
  .mcp.json                          only if open question 2 is answered "yes"
tests/                               node:test suites, fixtures (recorded hook inputs), e2e rig
examples/demo-repo/                  small project with deliberate portability bugs
site/                                static site + build.mjs (ADR-006)
docs/                                research, adr, PRIVACY.md, SECURITY-MODEL.md, manifest-spec.md, hub-api.md, VERIFICATION.md, commands.md
scripts/                             demo.mjs, release.mjs, check-site-commands.mjs (Node only)
.github/workflows/ci.yml             ubuntu, macos, windows matrix
LICENSE  SECURITY.md  CONTRIBUTING.md  CHANGELOG.md  README.md
```

Dependencies: none at runtime, none at dev time (tests use `node:test`).
Adding any dependency, including dev-only, requires your approval.

## 4. Phases

Every phase ends with: summary of what was built, what was verified and
how (commands and output), what is unverified (added to
`docs/VERIFICATION.md`), what we need from you. Then we stop.

### Phase 1 — Skeleton, marketplace, CI matrix

Tasks: manifests; `hooks/run.mjs` with the fail-open contract and a
no-op verb per event; `bin/synchrobuilder.mjs` with `--version` and
`--help`; `tests/` harness that replays recorded hook inputs through the
real hook program; CI on ubuntu/macos/windows running `node --test`,
`node --check`, `claude plugin validate --strict` on both manifests;
LICENSE, SECURITY.md, CONTRIBUTING.md, CHANGELOG.md, README with the two
install commands.

Acceptance: `claude --plugin-dir plugins/synchrobuilder -p ...` on all three
CI OSes shows every hook firing with exit 0 (stream-json
`hook_response`), and a deliberately missing `node` shows the documented
non-blocking error; hook p50 under 50 ms on each OS as measured by the test
harness (numbers recorded, not asserted, on Windows until we know them);
`claude plugin validate --strict` passes; a local marketplace install
(`claude plugin marketplace add ./` then `claude plugin install
synchrobuilder@synchrobuilder`) works on all three OSes in CI.

### Phase 2 — Audit

Tasks: rules engine (`lib/rules/*.mjs`, one file per rule, `{id, severity,
explain, locate, suggest}`), the ten rule families from the brief, terminal
report, JSON report, 0–100 score, `--strict` exit code; `examples/demo-repo`
with at least one deliberate failure per rule; `/synchrobuilder:audit`
skill; `npx synchrobuilder audit`.

Acceptance: every rule has positive and negative fixtures and passes on
three OSes; the demo repo scores below 50 with every planted bug found;
running audit on this repository itself scores 100.

### Phase 3 — Fix and guard

Tasks: fixers for import casing, `.gitattributes`, Unix commands in
package scripts (to `node` equivalents), string path concatenation;
`/synchrobuilder:fix` shows a diff and applies only on approval (the skill
instructs Claude to present the diff and wait; the CLI has `--dry-run` and
`--yes`); guard verb on `PostToolUse` (`Edit|Write|NotebookEdit`) that
audits the single file and returns `additionalContext` only when a new
finding appeared compared to the cached pre-edit state; `/synchrobuilder:mute`
flag file.

Acceptance: fix turns the demo repo's audit score to 100 with no manual
edits; guard hook p50 under 50 ms and under 200 ms max on the demo repo's
largest file; a headless run shows the guard's advice reaching Claude in the
same turn (token-echo test like E2); muted guard produces no output.

### Phase 4 — Manifest, setup, doctor, CI generator

Tasks: `synchrobuilder.json` reader/writer and `docs/manifest-spec.md`
(ADR-004); `/synchrobuilder:init` detection (Node/pnpm/yarn/npm versions,
lockfiles, `.env.example` names, common services from docker-compose,
scripts); `/synchrobuilder:setup` plan-then-ask-per-step runner with native
installers (winget, brew, apt) never elevated silently; `/synchrobuilder:doctor`
fingerprint and diff; `/synchrobuilder:ci` workflow and badge generator.

Acceptance: the demo repo's generated workflow passes on all three OSes;
setup on a clean CI runner reaches a passing health check for the demo repo
(non-interactive mode answers "yes" only under `--yes`); doctor on a runner
missing Postgres reports it first with the OS-specific fix.

### Phase 5 — Multiplayer transport and identity

Tasks per ADR-001: transport interface (`probe`, `publish`, `pull`,
`status`); git runner with argv-only spawning, hidden bare repo per
normalized remote URL, environment and config hygiene, timeouts and error
classification; writer (`hash-object`, `mktree`, `commit-tree`,
`push --force-with-lease`, `[skip ci]`); reader (namespace fetch into a
private local namespace, validation caps, atomic `snapshot.json`, local
first-seen times); host fallback ladder (custom refs, then fast-forward
branches, then read-only); detached worker with lock, pid liveness, kick
file, jittered cadence, session-liveness exit and the async `Stop` keeper;
per-checkout discovery from hooks by file reads only; identity (ADR-002)
and `/synchrobuilder:iam`; redaction (`lib/redact.mjs`, shared with the
ADR-005 sanitizer); `docs/hub-api.md` sketch; `docs/PRIVACY.md` first
draft.

Acceptance: e2e test with a local bare remote and two clones on all three
OSes: both developers' state visible to each other within one sync
interval; work done offline is published on the first successful tick;
force-push of another writer's ref, `push --mirror` from an ordinary
clone, a poisoned ref (blob at the tree root, 60k entries, 1 MB blobs),
shallow clone, missing remote, rejected push and a custom-namespace
rejection (simulated with a `pre-receive` hook) all fail open with a log
line, a `transport.status` value and no hook output; the user's branches
and worktree are never touched (asserted by `git status` and `git branch`
in the test); hooks never spawn git (asserted by a `PATH` without git in the
hook test); redaction corpus passes; the real-host push matrix (GitHub at
least; GitLab, Bitbucket, Azure DevOps as available) recorded in
`docs/VERIFICATION.md`; detached worker survival measured on Windows and
Linux CI.

### Phase 6 — Multiplayer features

Tasks: presence and task summary; session digest (6 KB cap, relevance
filter); claims and collision (warn default, ask opt-in, once per file per
30 min, staleness downgrade); notify; task board; handoff (staged on Stop);
contract change alerts (configurable paths, export-symbol diff);
`/synchrobuilder:status` with the seats notice module (`lib/seats.mjs`,
isolated); optional monitor for faster delivery.

Acceptance: e2e test extends Phase 5 with presence, collision warning
(asserted through the hook's JSON), notify round trip, handoff appearing in
the other developer's next digest, board claim/complete with a dependency
blocking; prompt-injection suite (ADR-005) passes for every shared field;
digest never exceeds 6 KB on a fixture with 50 teammates and 500 claims;
seats notice appears once per week only when more than three handles were
active in 30 days.

### Phase 7 — Website

Tasks per ADR-006: seven pages, install block with copy buttons, Commands
page generated from skills, terminal demos from `scripts/demo.mjs` output,
dark mode, GitHub Pages workflow.

Acceptance: Lighthouse performance and accessibility at or above 95 on the
built site (numbers recorded in VERIFICATION.md); every command on the
site exists in the plugin (CI check); no testimonials, logos, numbers or
claims without a test behind them.

### Phase 8 — Docs, demo, release checklist

Tasks: `docs/PRIVACY.md`, `docs/SECURITY-MODEL.md`, `docs/VERIFICATION.md`,
`docs/commands.md`, `scripts/demo.mjs` two-terminal walkthrough,
`CHANGELOG.md` 1.0.0, release script using `claude plugin tag`, manual
verification pass of the interactive-only items on macOS and Windows.

Acceptance: definition of done from the brief (section 10), item by item,
with evidence links.

## 5. Testing and verification strategy

- Unit: `node --test tests/unit/**` on three OSes; one fixture pair per rule.
- Hook replay: recorded inputs from `docs/research/evidence/` and new ones
  per event, piped into the real `hooks/run.mjs`, asserting output JSON,
  exit code and wall time.
- Real CLI: a small number of `claude -p --plugin-dir ... --output-format
  stream-json --include-hook-events` runs in CI (they cost API money; gated
  behind a secret and run on a schedule plus release branches).
- E2E multiplayer: local bare repo, two clones, no Claude.
- Injection: a corpus of payloads per shared field; assertions on the
  sanitized output and on the wrapper's integrity.
- Interactive-only items (permission prompts, status line rendering,
  monitors, `/plugin` menu, Desktop app) are verified by hand on macOS and
  Windows before each release and listed in `docs/VERIFICATION.md` with
  date and version; anything not done stays listed as unverified.
- Claims on the website or README link to the test that proves them.

## 6. Risks (with the mitigation we plan)

| Risk | Evidence | Mitigation |
| :-- | :-- | :-- |
| `node` not on PATH in Claude Code's environment (Desktop app, minimal launchers) | E3: every hook shows an error notice; Relay's own Desktop test had a full PATH, so the scale of the problem is unknown | Install page prerequisite; `doctor` check; troubleshooting per OS; no shell wrapper by principle |
| Windows shell for monitors and status line (Git Bash vs PowerShell placeholder handling) | docs: shell-form only; PowerShell rewrite of placeholders is version-gated | Both are optional features; test both shells on Windows CI; forward-slash paths only |
| Git host rejects custom ref namespace or hides it | GitHub REST docs accept any `refs/` name; GitLab/Azure/Bitbucket unverified | Fallback ladder to fast-forward branches, then read-only (ADR-001); real-host matrix in Phase 5 |
| State pushes trigger CI workflows, webhooks and notifications | Judges: `on: push` without a branch filter fires on `refs/heads/*` | Custom namespace by default; `[skip ci]` and `-o ci.skip` in branch mode; docs tell teams to exclude the namespace |
| A teammate with push access poisons or overwrites state | Judges reproduced a poisoned shared tip blocking every writer; per-writer refs unaffected | Per-writer refs, reader-side validation caps, `verified=` labels, no read-before-write (ADR-001, ADR-005) |
| `git push --mirror` from an ordinary clone deletes state refs | Reproduced by the judges | Self-heals on the next tick; docs warn migration tools |
| Large-ref remotes make every push download a multi-MB advertisement | Judges measured 12 MB at 100k refs | Heartbeat interval scales with advertisement size; fetch stays cheap under protocol v2 |
| SessionEnd 1.5 s plugin budget | hooks.md L3348-L3350 | Stage handoff on Stop; worker finalizes |
| `ask` becomes deny in headless/`dontAsk` | permissions and errors pages | Downgrade to warn using `permission_mode` from hook input |
| Third-party marketplace updates are manual by default | discover-plugins | `status` shows installed vs latest version from the state branch; docs explain `/plugin update` |
| `owner/repo` clones over SSH by default | env-vars L334 | Install page leads with the HTTPS git URL form |
| Docs describe v2.1.276; users run older CLIs | E2 on 2.1.218 | CI runs both the pinned older CLI and latest; feature-detect by hook input fields |
| Two sessions in one repo, laptops sleeping mid-push, clock skew | design | Lock file with PID and heartbeat; idempotent pushes; server-independent timestamps compared with tolerance; stale data downgrades |
| Prompt injection through shared fields | threat model (ADR-005) | Sanitizer, nonce-delimited wrapper, length caps, test corpus |
| Secret leakage in shared fields | privacy principle | Redaction on every outbound field; env values never read; test corpus |
| Hook latency on Windows CI (Defender, cold JIT) | unknown | Measure in Phase 1 before promising numbers |
| CRLF checkouts (`core.autocrlf`) altering `hooks.json` or `SKILL.md` | unknown | `.gitattributes` in the repo forces LF; CI tests a CRLF checkout |
| Long paths on Windows | brief | Short state paths; test with a deep demo repo path |
| Node 24.7 crash under `NODE_USE_SYSTEM_CA` | Relay report; not reproduced on 24.16 | Natural exit; re-test if a runner has 24.7 |

## 7. Working agreement

Small focused commits; CHANGELOG kept current; ask before dependencies, ADR
changes, or anything touching a machine outside the repo; never claim
something works without showing the run; a red Windows job blocks release.

## 8. Open questions for you

Decisions taken on 2026-09-18 when the owner said "start building": each
question below is answered with a default that can be changed later; the
defaults are marked **(default taken)**.

1. **Names.** Keep `init`, `doctor`, `status` as in the brief (full form
   only, since the bare forms belong to Claude Code), or rename to
   `manifest`, `diagnose`, `team` so the bare forms work? We lean to
   keeping the brief's names. Also: `board` for the task board?
   **(default taken: brief's names kept; `board` for the task board.)**
2. **Free-text commands and the background worker.** Two options:
   (A) skills tell Claude to run `node .../synchrobuilder.mjs notify <handle> "<text>"`
   through its Bash/PowerShell tool; simplest, but user text must be
   shell-quoted by Claude on two different shells. (B) a small stdio MCP
   server written by us with no dependency (JSON-RPC over stdio; the
   protocol subset is small) that exposes `notify`, `claim`, `board`,
   `handoff`, `status` as typed tools and doubles as the session's
   background worker, since Claude Code starts it with the plugin and stops
   it with the session. We recommend B, with A as the fallback for
   `--strict-mcp-config` environments. Your call; B adds a process per
   session and about 300 lines of protocol code.
   **(default taken: A for v1; the worker is the detached process from
   ADR-001 section 5. B stays open.)**
3. **Dev dependencies.** We propose none. Would you accept `tsc --checkJs`
   (TypeScript as a dev-only dependency) later for type checking of JSDoc?
   **(default taken: none.)**
4. **Status line consent flow.** OK to offer writing `statusLine` into the
   user's `~/.claude/settings.json` (shown in full, replaced not merged)?
   **(default taken: yes, only with `--yes` after `--plan` shows the change,
   with a backup of the settings file.)**
5. **Ref namespace.** Default to `refs/synchrobuilder/<handle>` (hidden from
   branch UIs, verified locally and per GitHub's API docs) with fallback to
   branches `synchrobuilder/<handle>` when a host rejects it? We need a
   throwaway repo on your GitHub org to test the real push in Phase 5.
   **(default taken: custom refs first, branches as fallback; hosted test
   still needed.)**
6. **GitHub owner/repo and marketplace name.** The install commands and
   website need the final `<owner>/<repo>`; we propose marketplace name
   `synchrobuilder` (install id `synchrobuilder@synchrobuilder`).
   **(default taken: marketplace name `synchrobuilder`; RyanNorouzi/synchrobuilder still a
   placeholder.)**
7. **Node floor.** `>=20` (LTS) or `>=22`? We propose 20.
   **(default taken: 20.)**
8. **Guard scope.** v1 guards `Edit|Write|NotebookEdit` only, not edits made
   through Bash (`sed -i`). Agree? **(default taken: yes.)**
9. **Website domain and waitlist address.** Placeholders until you decide;
   the site cannot ship "coming soon" pricing without an email target.
10. **Testing the marketplace install on your machine.** It writes to
    `~/.claude/plugins` and settings; we will only do it when you say so.
    **(default taken: not done on your machine; headless runs use
    `--plugin-dir` and a scratch `SYNCHROBUILDER_HOME`.)**
11. **Relay credit.** We reuse ideas, not code. If we later copy any code,
    we add the MIT notice and a `NOTICE` file. OK? **(default taken: ideas
    only; no code copied.)**

## 9. Phase 0 verification ledger

Verified by running (see `docs/research/experiments.md`): manifest
validation; exec-form Node hooks for six events in a real headless session
on macOS with CLI 2.1.218, including context delivery and env vars; fail-open
without `node`; hook latency about 20 ms; detached worker survival; git
plumbing for per-developer refs on a local bare remote, including shallow
clones (E8); the Node crash non-reproduction. The design judges' own local
git experiments (push races, poisoned trees, mirror pushes, namespace
fetch conflicts) are recorded in
`docs/research/evidence/transport-design-panel.json`.

Not verified (needs another machine or an interactive session): anything
on Windows or Linux; marketplace install through `/plugin`; permission
prompt rendering for `ask`; status line rendering; monitors; the menu
short-form matching; pushes to custom refs on a hosted git provider; the
Desktop app's PATH.
