// board add <title> [--deps a,b] | take <id> | done <id> | next | list: a minimal shared task list with dependencies, folded
// from every writer's board plus this checkout's journal. Changes are journal events the worker publishes.
import { isTaskId, LIMITS } from '../core/schema.mjs';
import { resolveContext, terminalSafe } from '../features/common.mjs';
import { appendJournal, readJournalTail } from '../features/journal-write.mjs';
import { foldBoard, nextTask, makeTaskId, summarizeBoard } from '../features/board-fold.mjs';
import { cleanLine } from '../features/handoff-text.mjs';

const USAGE = 'Usage: synchrobuilder board add <title...> [--deps a,b] | take <id> | done <id> | next | list [--json]\n';

function row(t) {
  const status = t.status === 'open' && t.blockedBy.length ? 'blocked' : t.status;
  return `  ${status.padEnd(11)} ${t.id.padEnd(24)} ${(t.owner || '-').padEnd(12)} ${t.deps.length ? t.deps.join(',') : '-'}  ${terminalSafe(t.title, 70)}`;
}

function listText(tasks) {
  if (!tasks.length) return 'Board is empty. Add a task: synchrobuilder board add <title>\n';
  const c = summarizeBoard(tasks);
  return [`  ${'STATUS'.padEnd(11)} ${'ID'.padEnd(24)} ${'OWNER'.padEnd(12)} DEPS  TITLE`, ...tasks.map(row), '', `${c.open} open, ${c['in-progress']} in progress, ${c.blocked} blocked, ${c.done} done`].join('\n') + '\n';
}

export async function run({ flags, args, cwd, stdout, stderr }) {
  const c = resolveContext(cwd);
  if (!c) { stderr.write('Not inside a git repository.\n'); return 1; }
  const events = readJournalTail(c.checkoutDir, { maxBytes: 1024 * 1024 });
  const tasks = foldBoard(c.snapshot, events, c.now);
  const op = (args[0] || 'list').toLowerCase();
  const me = c.identity ? c.identity.handle : null;
  const emit = (task, opName) => appendJournal(c.checkoutDir, { type: 'board', op: opName, task: { id: task.id, title: task.title, deps: task.deps, status: task.status, owner: task.owner } });

  if (op === 'list') {
    if (flags.json) stdout.write(JSON.stringify({ tasks, counts: summarizeBoard(tasks), next: nextTask(tasks) }, null, 2) + '\n');
    else stdout.write(listText(tasks));
    return 0;
  }
  if (op === 'next') {
    const t = nextTask(tasks);
    if (flags.json) { stdout.write(JSON.stringify({ next: t }, null, 2) + '\n'); return 0; }
    if (!t) {
      const blocked = tasks.filter((x) => x.status === 'open' && !x.owner && x.blockedBy.length);
      stdout.write(`Nothing is ready.${blocked.length ? ` Blocked: ${blocked.map((x) => `${x.id} (waits for ${x.blockedBy.join(', ')})`).join('; ')}.` : ''}\n`);
      return 0;
    }
    stdout.write(`Next: ${t.id}  ${terminalSafe(t.title, 100)}${t.deps.length ? `  (deps done: ${t.deps.join(', ')})` : ''}\nTake it with: synchrobuilder board take ${t.id}\n`);
    return 0;
  }
  if (op === 'add') {
    const title = cleanLine(args.slice(1).join(' ')).slice(0, LIMITS.title);
    if (!title) { stderr.write(USAGE); return 1; }
    const deps = typeof flags.deps === 'string' ? [...new Set(flags.deps.split(',').map((d) => d.trim()).filter(Boolean))] : [];
    const bad = deps.filter((d) => !isTaskId(d));
    if (bad.length) { stderr.write(`Invalid dependency id(s): ${bad.join(', ')}\n`); return 1; }
    const known = new Set(tasks.map((t) => t.id));
    const task = { id: makeTaskId(title), title, deps: deps.slice(0, LIMITS.deps), status: 'open', owner: null };
    if (!emit(task, 'add')) { stderr.write('Could not write to the local journal.\n'); return 1; }
    const unknown = deps.filter((d) => !known.has(d));
    if (flags.json) stdout.write(JSON.stringify({ ok: true, task, unknownDeps: unknown }, null, 2) + '\n');
    else stdout.write(`Added ${task.id}: ${title}${deps.length ? ` (depends on ${deps.join(', ')})` : ''}.${unknown.length ? ` Unknown dependency ids ${unknown.join(', ')} keep it blocked until they appear and complete.` : ''}\n`);
    return 0;
  }
  if (op === 'take' || op === 'done') {
    const id = args[1];
    if (!isTaskId(id || '')) { stderr.write(USAGE); return 1; }
    const t = tasks.find((x) => x.id === id);
    if (!t) { stderr.write(`No task ${id} on the board.\n`); return 1; }
    if (op === 'take') {
      if (!me) { stderr.write('Identity not resolved for this checkout; run /synchrobuilder:iam <handle> first.\n'); return 1; }
      if (t.owner && t.owner !== me && t.status !== 'done') { stderr.write(`${id} is already taken by ${t.owner}. They can release it with "board done" or you can add a new task.\n`); return 1; }
      if (t.blockedBy.length && !flags.force) { stderr.write(`${id} is blocked by ${t.blockedBy.join(', ')} (not done yet). Pass --force to take it anyway.\n`); return 1; }
      const next = { ...t, status: 'in-progress', owner: me };
      if (!emit(next, 'take')) { stderr.write('Could not write to the local journal.\n'); return 1; }
      stdout.write(flags.json ? JSON.stringify({ ok: true, task: next }) + '\n' : `Taken ${id}: ${terminalSafe(t.title, 100)}\n`);
      return 0;
    }
    const next = { ...t, status: 'done', owner: t.owner || me };
    if (!emit(next, 'done')) { stderr.write('Could not write to the local journal.\n'); return 1; }
    const unblocked = tasks.filter((x) => x.status === 'open' && x.blockedBy.length === 1 && x.blockedBy[0] === id).map((x) => x.id);
    stdout.write(flags.json ? JSON.stringify({ ok: true, task: next, unblocked }) + '\n' : `Done ${id}: ${terminalSafe(t.title, 100)}${unblocked.length ? ` (unblocks ${unblocked.join(', ')})` : ''}\n`);
    return 0;
  }
  stderr.write(USAGE);
  return 1;
}
