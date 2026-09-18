// claim <path or task-id> [--note text]: append a claim event to the local journal and kick the worker.
import { ulid, LIMITS } from '../core/schema.mjs';
import { redact } from '../safety/redact.mjs';
import { resolveContext, teammates, claimActive, claimAgeMs, pathsOverlap, fmtAgo } from '../features/common.mjs';
import { appendJournal, readJournalTail } from '../features/journal-write.mjs';
import { resolveClaimTarget, describeTarget } from '../features/claims.mjs';
import { foldBoard } from '../features/board-fold.mjs';
import { cleanLine } from '../features/handoff-text.mjs';

export function otherClaimsOn(c, target) {
  const out = [];
  for (const w of teammates(c.snapshot, c.identity)) {
    for (const cl of w.claims) {
      const hit = target.path ? cl.path && pathsOverlap(cl.path, target.path) : cl.task === target.task;
      if (hit && claimActive(cl, w, c.now)) out.push(`${w.handle} claims ${cl.path || `task ${cl.task}`} (${fmtAgo(claimAgeMs(cl, w, c.now))})`);
    }
  }
  return out;
}

export async function run({ flags, args, cwd, stdout, stderr }) {
  const c = resolveContext(cwd);
  if (!c) { stderr.write('Not inside a git repository.\n'); return 1; }
  if (!args[0]) { stderr.write('Usage: synchrobuilder claim <path or task-id> [--note text]\n'); return 1; }
  const boardIds = new Set(foldBoard(c.snapshot, readJournalTail(c.checkoutDir, { maxBytes: 1024 * 1024 }), c.now).map((t) => t.id));
  const target = resolveClaimTarget(c.loc, cwd, args[0], boardIds);
  if (!target) { stderr.write(`"${args[0]}" is neither a path inside this repository nor a task id (lowercase letters, digits, dashes).\n`); return 1; }
  const note = typeof flags.note === 'string' ? cleanLine(redact(flags.note).text).slice(0, LIMITS.task) : '';
  const event = { type: 'claim', id: ulid(c.now), ...target };
  if (note) event.note = note;
  if (!appendJournal(c.checkoutDir, event)) { stderr.write('Could not write to the local journal.\n'); return 1; }
  const others = otherClaimsOn(c, target);
  if (flags.json) { stdout.write(JSON.stringify({ ok: true, claim: event, overlaps: others }, null, 2) + '\n'); return 0; }
  stdout.write(`Claimed ${describeTarget(target)}${note ? ` (note: ${note})` : ''}. Teammates see it after the next sync; it expires after 4 h unless renewed.\n`);
  if (others.length) stdout.write(`Heads up: ${others.join('; ')}.\n`);
  return 0;
}
