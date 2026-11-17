// lease [list] | take <path> [--force] | release [path]: see and manage file leases (ADR-007).
// Leases are normally taken for you, by the pre-edit hook, the moment an agent starts on a file. This command is
// for looking, for letting go early, and for a person to free a file whose holder is not coming back.
import path from 'node:path';
import { readJson, touch } from '../core/fsx.mjs';
import { paths } from '../state/layout.mjs';
import { resolveContext, repoRelativePath, fmtAgo, MS } from '../features/common.mjs';
import { acquireLease, forceLease, remoteLeasesWanted } from '../features/leases.mjs';
import { releaseRecords } from '../features/lease-table.mjs';
import { leaseRows } from '../features/lease-view.mjs';

async function storeFor(c) {
  const wanted = remoteLeasesWanted({ config: c.config, identity: c.identity, remoteDir: c.loc.remoteDir, now: c.now, snapshot: c.snapshot, status: c.statusFile ? readJson(c.statusFile, null) : null });
  if (!wanted) return null;
  const { LeaseRefs } = await import('../transport/lease-refs.mjs');
  return new LeaseRefs({ remoteUrl: c.loc.remoteUrl, remoteDir: c.loc.remoteDir, handle: c.identity.handle, timeoutMs: 15000 });
}

function whoText(row) { return row.where === 'you' ? 'you (this working tree)' : row.where === 'here' ? 'another agent on this machine' : `${row.handle} (another machine)`; }
function kick(c) { try { touch(paths.checkout(c.checkoutDir).kick); } catch { /* the next tick will do */ } }

export async function run({ flags, args, cwd, stdout, stderr }) {
  const c = resolveContext(cwd);
  if (!c) { stderr.write('Not inside a git repository.\n'); return 1; }
  if (!c.loc.remoteDir) { stderr.write('This repository has no remote, so there is nobody to coordinate with and no leases.\n'); return 1; }
  const sub = args[0] && ['list', 'take', 'release'].includes(args[0]) ? args[0] : 'list';
  const rest = sub === args[0] ? args.slice(1) : args;
  const idleMs = c.config.leases.idleMinutes * MS.minute;
  const ttlMs = c.config.leases.ttlMinutes * MS.minute;

  if (sub === 'list') {
    const rows = leaseRows({ remoteDir: c.loc.remoteDir, identity: c.identity, now: c.now, idleMs });
    if (flags.json) { stdout.write(JSON.stringify({ mode: c.config.leases.mode, leases: rows.map(({ hash, ...r }) => r) }, null, 2) + '\n'); return 0; }
    if (c.config.leases.mode === 'off') stdout.write('Leases are switched off for this repository (leases.mode in .synchrobuilder/config.json).\n');
    if (!rows.length) { stdout.write('No files are held right now.\n'); return 0; }
    stdout.write(`Held files (${rows.length}):\n`);
    for (const r of rows) stdout.write(`  ${r.path}  held by ${whoText(r)}, since ${fmtAgo(c.now - Date.parse(r.at))}\n`);
    return 0;
  }

  if (!c.identity) { stderr.write('Identity not resolved yet. Start a session in this checkout, or run "synchrobuilder iam <handle>".\n'); return 1; }

  if (sub === 'release') {
    let rel = null;
    if (rest[0]) {
      rel = repoRelativePath(c.loc, cwd, rest[0]);
      if (!rel) { stderr.write(`"${rest[0]}" is not a path inside this repository.\n`); return 1; }
    }
    const n = releaseRecords(c.loc.remoteDir, (rec) => rec.checkoutDir === c.checkoutDir && (!rel || rec.path.toLowerCase() === rel.toLowerCase()));
    kick(c);
    if (flags.json) { stdout.write(JSON.stringify({ ok: true, released: n }, null, 2) + '\n'); return 0; }
    stdout.write(n ? `Released ${n} held file${n === 1 ? '' : 's'}. Agents on this machine can take ${n === 1 ? 'it' : 'them'} now; other machines within a minute.\n` : `Nothing held${rel ? ` on ${rel}` : ''} by this working tree.\n`);
    return 0;
  }

  // take
  if (!rest[0]) { stderr.write('Usage: synchrobuilder lease take <path> [--force]\n'); return 1; }
  const rel = repoRelativePath(c.loc, cwd, rest[0]);
  if (!rel) { stderr.write(`"${rest[0]}" is not a path inside this repository.\n`); return 1; }
  let store = null;
  try { store = await storeFor(c); } catch { store = null; }
  const opts = { loc: c.loc, identity: c.identity, sid: '', rel, now: c.now, ttlMs, idleMs, store, deadline: Date.now() + 30000 };
  let r = acquireLease(opts);
  let forced = false;
  if (r.status === 'denied' && flags.force) { r = forceLease(opts); forced = true; }
  kick(c);
  if (flags.json) { stdout.write(JSON.stringify({ ok: r.status === 'held' || r.status === 'acquired', forced, ...r }, null, 2) + '\n'); return r.status === 'denied' ? 1 : 0; }
  if (r.status === 'denied') {
    const h = r.holder;
    stderr.write(`${rel} is held by ${h.local ? 'another agent on this machine' : `${h.handle} on another machine`} (since ${fmtAgo(c.now - Date.parse(h.at))}). Pass --force to take it anyway; their next edit to it will be refused.\n`);
    return 1;
  }
  if (r.status === 'open') { stderr.write(`Could not take ${rel} (${r.reason || 'unknown'}). Nothing was changed.\n`); return 1; }
  const remote = r.remote === 'ok' ? ' on this machine and the remote' : r.remote === 'failed' ? ' on this machine (the remote could not be reached; the worker will retry)' : ' on this machine';
  stdout.write(`${forced ? 'Took over' : 'Holding'} ${rel}${remote}. ${path.basename(c.loc.workTree)} keeps it while a session here is running and touches it; with no session it is freed on the next sync.\n`);
  return 0;
}
