// Portability guard: audit one file before and after Claude edits it, and tell Claude about findings the edit introduced.
// Advisory only. Everything here runs inside a hook, so it never throws, never spawns anything and never prints.
//   before(ctx, toolInput)                -> null; caches the file's current finding signatures (PreToolUse)
//   after(ctx, toolInput, toolResponse)   -> { hookSpecificOutput } | null (PostToolUse)
// ctx is the hook context from lib/hooks/context.mjs ({ loc, muted, ... }).
import fs from 'node:fs';
import path from 'node:path';
import { auditFile } from '../audit/engine.mjs';
import { toRepoRelative } from '../core/paths.mjs';
import { logLine } from '../core/log.mjs';
import { LIMITS } from '../core/schema.mjs';
import { sanitizeLine } from '../safety/sanitize.mjs';
import { redact } from '../safety/redact.mjs';
import { readBaseline, writeBaseline, signature, newFindings } from './cache.mjs';

const MAX_LISTED = 8;
const MAX_FILE_BYTES = 512 * 1024;

/** Repo-relative POSIX path of the edited file, or null when the tool input names nothing inside the work tree. */
export function relativeTarget(workTree, toolInput) {
  const raw = toolInput && (toolInput.file_path || toolInput.notebook_path);
  return typeof raw === 'string' ? toRepoRelative(workTree, raw) : null;
}

function ready(ctx, toolInput) {
  if (!ctx || ctx.muted || !ctx.loc || !ctx.loc.workTree || !ctx.loc.checkoutDir) return null;
  const rel = relativeTarget(ctx.loc.workTree, toolInput);
  return rel ? { rel, workTree: ctx.loc.workTree, checkoutDir: ctx.loc.checkoutDir } : null;
}

function readSmall(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;
    return fs.readFileSync(file, 'utf8');
  } catch { return null; }
}

/** PreToolUse: remember what the file already had wrong. A missing file has no findings. */
export async function before(ctx, toolInput) {
  try {
    const t = ready(ctx, toolInput);
    if (!t) return null;
    const content = readSmall(path.join(t.workTree, t.rel));
    const findings = content === null ? [] : (await auditFile(t.workTree, t.rel, { content })).findings;
    writeBaseline(t.checkoutDir, t.rel, findings.map(signature));
  } catch (err) { logLine('guard', `before: ${err && err.message}`); }
  return null;
}

/** PostToolUse: re-audit from disk, diff against the baseline, and describe only the new findings. */
export async function after(ctx, toolInput, toolResponse) {
  try {
    const t = ready(ctx, toolInput);
    if (!t) return null;
    const content = readSmall(path.join(t.workTree, t.rel));
    if (content === null) return null;
    const { findings } = await auditFile(t.workTree, t.rel, { content });
    let baseline = readBaseline(t.checkoutDir, t.rel);
    // No pre-edit snapshot (the pre-edit hook did not run, or the entry was evicted): the tool's own copy of the original is the next best baseline.
    if (baseline === null && toolResponse && typeof toolResponse.originalFile === 'string') {
      baseline = (await auditFile(t.workTree, t.rel, { content: toolResponse.originalFile })).findings.map(signature);
    }
    const fresh = newFindings(findings, baseline || []);
    try { writeBaseline(t.checkoutDir, t.rel, findings.map(signature)); } catch (err) { logLine('guard', `after: cache write failed: ${err && err.message}`); }
    if (fresh.length === 0) return null;
    return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: describe(t.rel, fresh) } };
  } catch (err) {
    logLine('guard', `after: ${err && err.message}`);
    return null;
  }
}

/** A short factual note for Claude, under LIMITS.alertChars. Rule text is ours; the quoted fragments come from the user's own file. */
export function describe(rel, fresh) {
  const lines = [`Synchrobuilder guard: this edit introduced ${fresh.length} new portability finding${fresh.length === 1 ? '' : 's'} in ${sanitizeLine(rel, 200)}.`];
  const tail = 'This note is advisory and blocks nothing; /synchrobuilder:mute silences it for this checkout.';
  const room = LIMITS.alertChars - tail.length - 80;
  let used = lines[0].length;
  let listed = 0;
  for (const f of fresh.slice(0, MAX_LISTED)) {
    const where = f.line ? ` line ${f.line}` : '';
    const fix = f.fix ? ` Fix: ${sanitizeLine(f.fix, 240)}` : '';
    const line = `- ${sanitizeLine(f.rule, 40)}${where}: ${sanitizeLine(f.message, 200)}${fix}`;
    if (used + line.length + 1 > room) break;
    lines.push(line);
    used += line.length + 1;
    listed++;
  }
  if (listed < fresh.length) lines.push(`- and ${fresh.length - listed} more (run /synchrobuilder:audit for the full list).`);
  lines.push(tail);
  return redact(lines.join('\n')).text;
}
