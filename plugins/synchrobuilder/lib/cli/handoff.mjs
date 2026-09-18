// handoff [handle] [--draft] [--confirm <draft id> --done "a; b" --next "..." --for a,b ...]: show the staged draft, or turn it
// into a handoff journal event. Lists take ';'-separated items; --for takes comma-separated handles.
import { isHandle } from '../core/schema.mjs';
import { writeJsonAtomic } from '../core/fsx.mjs';
import { resolveContext } from '../features/common.mjs';
import { readJournalTail } from '../features/journal-write.mjs';
import { readDraft, stageHandoff, finalizeHandoff, draftFile } from '../features/handoff.mjs';

const LISTS = ['done', 'files', 'interfaces', 'decisions', 'blockers', 'next'];
const USAGE = 'Usage: synchrobuilder handoff [handle] [--draft] | --confirm <draft id> [--task t] [--done "a; b"] [--next "a; b"] [--decisions ..] [--blockers ..] [--interfaces ..] [--files a;b] [--for alice,bob]\n';

function splitList(v) { return typeof v === 'string' ? v.split(';').map((s) => s.trim()).filter(Boolean) : null; }

function draftText(d) {
  const lines = [`Handoff draft ${d.id}${d.from ? ` from ${d.from}` : ''}${d.branch ? ` on ${d.branch}` : ''} (staged ${d.stagedAt})`];
  if (d.task) lines.push(`  task: ${d.task}`);
  for (const k of [...LISTS, 'for']) {
    const items = Array.isArray(d[k]) ? d[k] : [];
    lines.push(`  ${k}: ${items.length ? '' : '(none)'}`);
    for (const it of items) lines.push(`    - ${it}`);
  }
  lines.push('', `Confirm with: synchrobuilder handoff --confirm ${d.id} [--done "..."] [--next "..."] [--for handle]`);
  return lines.join('\n') + '\n';
}

/** Build a draft on demand from the newest session in the journal, for a CLI run without a prior Stop hook. */
async function stageNow(c) {
  const events = readJournalTail(c.checkoutDir, { maxBytes: 1024 * 1024 });
  const sids = events.map((e) => e.sid).filter(Boolean);
  const sessionId = sids.length ? sids[sids.length - 1] : '';
  return stageHandoff({ loc: c.loc, sessionId, now: c.now }, {});
}

export async function run({ flags, args, cwd, stdout, stderr }) {
  const c = resolveContext(cwd);
  if (!c) { stderr.write('Not inside a git repository.\n'); return 1; }
  const handles = [...args, ...(typeof flags.for === 'string' ? flags.for.split(',') : [])].map((h) => h.trim().replace(/^@/, '')).filter(Boolean);
  const bad = handles.filter((h) => !isHandle(h));
  if (bad.length) { stderr.write(`Invalid handle(s): ${bad.join(', ')}\n${USAGE}`); return 1; }

  if (typeof flags.confirm === 'string' || flags.confirm === true) {
    const edits = {};
    for (const k of LISTS) { const v = splitList(flags[k]); if (v) edits[k] = v; }
    if (typeof flags.task === 'string') edits.task = flags.task;
    if (handles.length) edits.for = handles;
    const r = finalizeHandoff(c.checkoutDir, edits, { draftId: typeof flags.confirm === 'string' ? flags.confirm : undefined, now: c.now });
    if (!r.ok) { stderr.write(`${r.error}\n`); return 1; }
    if (flags.json) stdout.write(JSON.stringify({ ok: true, handoff: r.handoff }, null, 2) + '\n');
    else stdout.write(`Handoff ${r.handoff.id} recorded for ${r.handoff.for.length ? r.handoff.for.join(', ') : 'everyone'}; it is published on the next sync and appears in their next session digest.\n`);
    return 0;
  }

  let draft = readDraft(c.checkoutDir);
  if (!draft || draft.finalizedAt) draft = await stageNow(c);
  if (!draft) { stdout.write('Nothing to hand off yet: no edits, task summaries or contract changes recorded for this checkout.\n'); return 0; }
  if (handles.length) {
    draft = { ...draft, for: [...new Set([...(draft.for || []), ...handles])].slice(0, 8) };
    try { writeJsonAtomic(draftFile(c.checkoutDir), draft); } catch { /* shown anyway */ }
  }
  stdout.write(flags.json ? JSON.stringify(draft, null, 2) + '\n' : draftText(draft));
  return 0;
}
