// status: who is active (from the local snapshot), my identity, the transport state, my claims, the board, the seats notice.
// Teammate fields are validated identifiers; the task summary is reduced to printable ASCII (ADR-005 section 4).
import path from 'node:path';
import { readJson } from '../core/fsx.mjs';
import { homeDir } from '../core/paths.mjs';
import { resolveContext, fmtAgo, fmtShortAge, terminalSafe, hhmmZ } from '../features/common.mjs';
import { activeWriters } from '../features/presence.mjs';
import { readJournalTail } from '../features/journal-write.mjs';
import { ownClaims, describeTarget } from '../features/claims.mjs';
import { foldBoard, nextTask, summarizeBoard } from '../features/board-fold.mjs';
import { seatsNotice } from '../features/seats.mjs';

function table(rows, header) {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (r) => '  ' + r.map((c, i) => String(c).padEnd(widths[i])).join('  ').trimEnd();
  return [line(header), ...rows.map(line)].join('\n');
}

function transportLine(status, snapshot) {
  if (!status && !snapshot) return 'Sync: no worker has run for this remote yet (start a Claude Code session in this checkout).';
  const mode = status && typeof status.mode === 'string' ? status.mode.replace(/[^a-z-]/g, '') : 'unknown';
  const ok = status && status.lastOkAt ? `last ok ${hhmmZ(status.lastOkAt)}` : 'never succeeded';
  const err = status && status.lastErrorClass ? `, last error ${String(status.lastErrorClass).replace(/[^a-z-]/g, '')}` : '';
  const pid = status && Number.isInteger(status.workerPid) ? `, worker pid ${status.workerPid}` : '';
  return `Sync: mode ${mode}, ${ok}${err}${pid}`;
}

export async function run({ flags, cwd, stdout, stderr }) {
  const c = resolveContext(cwd);
  if (!c) { stderr.write('Not inside a git repository.\n'); return 1; }
  const now = c.now;
  const status = c.statusFile ? readJson(c.statusFile, null) : null;
  const rows = activeWriters(c.snapshot, now, c.identity);
  const events = readJournalTail(c.checkoutDir, { maxBytes: 1024 * 1024 });
  const claims = ownClaims(events, now);
  const tasks = foldBoard(c.snapshot, events, now);
  const notice = seatsNotice(c.snapshot, now, path.join(homeDir(), 'seats.json'), { noticeEveryDays: c.config.seats.noticeEveryDays });
  if (flags.json) {
    const out = {
      repo: c.loc.repoName, identity: c.identity, remoteUrl: c.loc.remoteUrl ? 'configured' : null,
      snapshot: c.snapshot ? { fetchedAt: c.snapshot.fetchedAt, ageMs: c.snapshot.ageMs, tier: c.snapshot.tier, writers: c.snapshot.writers.length } : null,
      transport: status, teammates: rows.map((r) => ({ handle: r.handle, device: r.device, branch: r.branch, area: r.area, task: terminalSafe(r.task, 140), ageMs: r.ageMs, tier: r.tier, verified: r.verified, claims: r.writer.claims.length })),
      myClaims: claims, board: { counts: summarizeBoard(tasks), next: nextTask(tasks), tasks: tasks.map((t) => ({ ...t, title: terminalSafe(t.title, 100) })) }, seatsNotice: notice,
    };
    stdout.write(JSON.stringify(out, null, 2) + '\n');
    return 0;
  }
  const lines = [`Synchrobuilder status for ${c.loc.repoName}`];
  lines.push(c.identity ? `You: ${c.identity.handle} on device ${c.identity.device} (${c.identity.source})` : 'You: identity not resolved yet (start a session, or run /synchrobuilder:iam <handle>)');
  lines.push(transportLine(status, c.snapshot));
  if (c.snapshot) lines.push(`Snapshot: fetched ${fmtAgo(c.snapshot.ageMs)} (${c.snapshot.tier}), ${c.snapshot.writers.length} writer${c.snapshot.writers.length === 1 ? '' : 's'}`);
  lines.push('');
  if (rows.length) {
    lines.push(`Teammates (${rows.length} seen in the last 24 h):`);
    lines.push(table(rows.map((r) => [r.handle, r.branch || '-', r.area || '-', `${fmtShortAge(r.ageMs)} ${r.tier}`, r.verified === 'yes' ? 'yes' : r.verified, terminalSafe(r.task) || '-']), ['HANDLE', 'BRANCH', 'AREA', 'SEEN', 'VERIFIED', 'TASK']));
  } else lines.push('Teammates: none seen in the last 24 h.');
  lines.push('');
  lines.push(claims.length ? `My claims: ${claims.map((cl) => `${describeTarget(cl)} (${fmtAgo(now - Date.parse(cl.at))})`).join(', ')}` : 'My claims: none.');
  const counts = summarizeBoard(tasks);
  const next = nextTask(tasks);
  lines.push(`Board: ${counts.open} open, ${counts['in-progress']} in progress, ${counts.blocked} blocked, ${counts.done} done${next ? ` (next: ${next.id} ${terminalSafe(next.title, 50)})` : ''}`);
  if (notice) lines.push('', notice);
  stdout.write(lines.join('\n') + '\n');
  return 0;
}
