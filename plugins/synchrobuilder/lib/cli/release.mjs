// release [path or task-id]: append a release event (no argument releases every claim of this checkout) and kick the worker.
import { resolveContext } from '../features/common.mjs';
import { appendJournal, readJournalTail } from '../features/journal-write.mjs';
import { resolveClaimTarget, describeTarget, ownClaims } from '../features/claims.mjs';
import { foldBoard } from '../features/board-fold.mjs';

export async function run({ flags, args, cwd, stdout, stderr }) {
  const c = resolveContext(cwd);
  if (!c) { stderr.write('Not inside a git repository.\n'); return 1; }
  const events = readJournalTail(c.checkoutDir, { maxBytes: 1024 * 1024 });
  const mine = ownClaims(events, c.now);
  let event = { type: 'release' };
  let what = 'all claims';
  if (args[0]) {
    const boardIds = new Set(foldBoard(c.snapshot, events, c.now).map((t) => t.id));
    const target = resolveClaimTarget(c.loc, cwd, args[0], boardIds);
    if (!target) { stderr.write(`"${args[0]}" is neither a path inside this repository nor a task id.\n`); return 1; }
    const held = mine.find((cl) => (target.path ? cl.path === target.path : cl.task === target.task));
    if (!held) stdout.write(`Note: no active claim on ${describeTarget(target)} in this checkout's journal; releasing anyway in case one is published.\n`);
    event = { type: 'release', ...(held && held.id ? { id: held.id } : {}), ...target };
    what = describeTarget(target);
  } else if (!mine.length) {
    stdout.write('No active claims to release.\n');
    return 0;
  }
  if (!appendJournal(c.checkoutDir, event)) { stderr.write('Could not write to the local journal.\n'); return 1; }
  if (flags.json) { stdout.write(JSON.stringify({ ok: true, release: event }, null, 2) + '\n'); return 0; }
  stdout.write(`Released ${what}. Teammates see it after the next sync.\n`);
  return 0;
}
