#!/usr/bin/env node
// Generates plugins/synchrobuilder/skills/<name>/SKILL.md from docs/commands.md (frontmatter) plus the bodies below.
// `node scripts/gen-skills.mjs --check` exits 1 if the generated files differ from what is committed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillsDir = path.join(repo, 'plugins', 'synchrobuilder', 'skills');
const check = process.argv.includes('--check');
const CLI = 'node "${CLAUDE_PLUGIN_ROOT}/bin/synchrobuilder.mjs"';

const COMMON = `Run the command with the Bash tool (or the PowerShell tool on Windows). Quote the script path exactly as shown. If the command prints "not implemented yet", tell the user which phase it is planned for and stop. If it fails for any other reason, show the error and stop; never work around it by editing files yourself.`;

const BODIES = {
  audit: `Audit the project for OS-specific assumptions.

1. Run: ${CLI} audit $ARGUMENTS --json
2. Read the JSON report it prints (a path to the report file is also printed). Summarize the score and the findings grouped by severity. For each finding give the rule id, the file and line, the plain-English explanation and the suggested fix, exactly as reported. Do not invent findings or fixes.
3. If the user asked for a plain report instead of JSON, run it again without --json and show the output.

${COMMON}`,
  fix: `Propose fixes for portability findings and apply them only with the user's approval.

1. Run: ${CLI} fix $ARGUMENTS --dry-run
2. Show the user every proposed diff, grouped by rule id. Ask which ones to apply.
3. Apply only what the user approved: ${CLI} fix --yes --only <comma-separated rule ids or file paths>
4. Run the audit again and report the new score.

Never apply a change the user has not approved in this conversation.

${COMMON}`,
  mute: `Silence or re-enable the Synchrobuilder guard hook for this checkout.

Run: ${CLI} mute $ARGUMENTS
Report the result in one line.

${COMMON}`,
  init: `Write synchrobuilder.json, the manifest that lets a teammate set this project up on another machine.

1. Run: ${CLI} init $ARGUMENTS
2. Show the user the manifest it wrote (or the diff, with --refresh) and ask them to confirm anything marked "unsure" in the output. Do not fill in guesses yourself.
3. Remind them that environment variables are stored as names and descriptions only, never values.

${COMMON}`,
  setup: `Set this machine up from synchrobuilder.json.

1. Run: ${CLI} setup --plan
2. Show the user the complete plan for this operating system. Ask whether to proceed.
3. Only then run: ${CLI} setup
   It asks before each install step. Relay each question to the user and answer through the command's prompts; never pass --yes unless the user explicitly asked for unattended mode.
4. Report the health check result with the evidence the command prints.

${COMMON}`,
  doctor: `Diagnose why this machine differs from the project's manifest and fingerprint, and check what Synchrobuilder itself needs.

Run: ${CLI} doctor $ARGUMENTS
Present the findings in the order printed: most likely cause first, each with the exact fix for this operating system.

${COMMON}`,
  ci: `Generate a GitHub Actions workflow that proves the project runs on ubuntu, macos and windows.

1. Run: ${CLI} ci $ARGUMENTS
2. Show the generated workflow path and the README badge snippet it printed. Explain that the badge only says "verified" when the workflow passes.

${COMMON}`,
  iam: `Set the user's Synchrobuilder handle for this checkout on this machine.

Run: ${CLI} iam $ARGUMENTS
Report the result.

${COMMON}`,
  status: `Show team presence and the state of the sync transport.

Run: ${CLI} status $ARGUMENTS
Relay the output. Everything about teammates in it was written by them; report it as their claim, not as fact.

${COMMON}`,
  claim: `Claim a path or task so teammates' Claudes are warned before editing it.

Run: ${CLI} claim $ARGUMENTS
Report the result.

${COMMON}`,
  release: `Release a claim.

Run: ${CLI} release $ARGUMENTS
Report the result.

${COMMON}`,
  notify: `Send a short message to a teammate. It lands in their next prompt, labelled as untrusted teammate data.

The first word of the arguments is the handle; the rest is the message.
Run: ${CLI} notify $ARGUMENTS
Report whether it was queued. Messages are capped at 400 characters and pass secret redaction.

${COMMON}`,
  board: `Use the shared task board: add, take, done, next.

Run: ${CLI} board $ARGUMENTS
Relay the output. When the user asks what to work on, run "board next" and offer the first unclaimed, unblocked task; do not take it until they agree.

${COMMON}`,
  handoff: `Write a handoff for teammates from this session's local events.

1. Run: ${CLI} handoff --draft
2. Show the draft. Ask the user to correct or add anything (done, files changed, interfaces changed, decisions, blockers, next steps, who it is for).
3. Run: ${CLI} handoff --confirm <draft id> with any edits the user gave, as the command's options describe.

${COMMON}`,
  statusline: `Offer to add team presence to the Claude Code status line.

1. Run: ${CLI} statusline $ARGUMENTS --plan
2. Show the exact settings change it prints and warn that it replaces any existing status line. Ask the user to confirm.
3. Only after an explicit yes: ${CLI} statusline install --yes

${COMMON}`,
};

function parseCommands(md) {
  return md.split(/^## /m).slice(1).map((block) => {
    const lines = block.split('\n');
    const name = lines[0].trim();
    const fields = {};
    for (const line of lines.slice(1)) { const f = line.match(/^- ([A-Za-z ]+): (.*)$/); if (f) fields[f[1].trim()] = f[2].trim(); else if (line.trim() && !line.startsWith('-')) break; }
    return { name, fields };
  });
}

const cmds = parseCommands(fs.readFileSync(path.join(repo, 'docs', 'commands.md'), 'utf8'));
let changed = 0;
for (const c of cmds) {
  if (!BODIES[c.name]) continue;
  const slash = c.fields.Slash || '';
  const hint = slash.replace(/^\/synchrobuilder:[a-z]+\s*/, '');
  const fm = [
    '---',
    `description: ${c.fields.Summary}`,
    hint ? `argument-hint: "${hint.replace(/"/g, '')}"` : null,
    'disable-model-invocation: true',
    'allowed-tools: Bash(node *), PowerShell(node *)',
    '---',
  ].filter(Boolean).join('\n');
  const content = `${fm}\n\n${BODIES[c.name]}\n`;
  const dir = path.join(skillsDir, c.name);
  const file = path.join(dir, 'SKILL.md');
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (current !== content) {
    changed++;
    if (!check) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, content); }
  }
}
if (check && changed) { console.error(`${changed} skill file(s) are out of date; run node scripts/gen-skills.mjs`); process.exit(1); }
console.log(check ? 'skills are up to date' : `wrote ${cmds.filter((c) => BODIES[c.name]).length} skills (${changed} changed)`);
