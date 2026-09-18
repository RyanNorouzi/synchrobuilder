#!/usr/bin/env node
// Claude Code status line renderer: reads the status-line JSON from stdin, locates the checkout from its cwd by file reads
// only, and prints one line such as "sb ● alice feat/x · bob main (3m) · sync ok 09:41Z". Validated identifiers only,
// never free text (ADR-005 section 4). Never throws; on any problem it prints "sb" and exits 0.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { locate } from '../core/paths.mjs';
import { readJson } from '../core/fsx.mjs';
import { validBranch } from '../core/schema.mjs';
import { readIdentity, loadSnapshot, fmtShortAge, hhmmZ } from '../features/common.mjs';
import { activeWriters } from '../features/presence.mjs';

const MAX_TEAMMATES = 4;

function syncPart(loc, snapshot, now) {
  const status = loc.remoteDir ? readJson(path.join(loc.remoteDir, 'status.json'), null) : null;
  if (!status && !snapshot) return 'sync off';
  if (snapshot && snapshot.tier === 'gone') return `sync stale ${fmtShortAge(snapshot.ageMs)}`;
  if (status && typeof status.lastErrorClass === 'string' && status.lastErrorClass) return `sync ${status.lastErrorClass.replace(/[^a-z-]/g, '')}${status.lastOkAt ? ' ' + hhmmZ(status.lastOkAt) : ''}`;
  const okAt = status && status.lastOkAt ? status.lastOkAt : snapshot ? snapshot.fetchedAt : null;
  return okAt ? `sync ok ${hhmmZ(okAt)}` : 'sync pending';
}

/** Pure renderer, exported for tests. */
export function renderLine({ cwd, now = Date.now() }) {
  const loc = locate(cwd);
  if (!loc) return 'sb';
  const identity = readIdentity(loc.checkoutDir);
  const own = readJson(path.join(loc.checkoutDir, 'own', 'presence.json'), null);
  const myBranch = own && validBranch(own.branch);
  const me = identity ? `${identity.handle}${myBranch ? ' ' + myBranch : ''}` : 'no identity';
  const snapshot = loadSnapshot(loc.remoteDir ? path.join(loc.remoteDir, 'snapshot.json') : null, now);
  const rows = activeWriters(snapshot, now, identity);
  const shown = rows.slice(0, MAX_TEAMMATES).map((r) => `${r.handle}${r.branch ? ' ' + r.branch : ''} (${fmtShortAge(r.ageMs)})`);
  if (rows.length > MAX_TEAMMATES) shown.push(`+${rows.length - MAX_TEAMMATES}`);
  const team = shown.length ? shown.join(' · ') : 'no teammates';
  return `sb ● ${me} · ${team} · ${syncPart(loc, snapshot, now)}`;
}

function readStdin(limitMs = 150) {
  return new Promise((resolve) => {
    let data = '';
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(data); } };
    try {
      if (process.stdin.isTTY) return finish();
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (c) => { if (data.length < 65536) data += c; });
      process.stdin.on('end', finish);
      process.stdin.on('error', finish);
    } catch { finish(); }
    setTimeout(finish, limitMs).unref();
  });
}

async function main() {
  let line = 'sb';
  try {
    const raw = await readStdin();
    let input = {};
    try { input = raw.trim() ? JSON.parse(raw) : {}; } catch { /* no input: fall back to process.cwd() */ }
    const cwd = (input.workspace && typeof input.workspace.current_dir === 'string' && input.workspace.current_dir) || (typeof input.cwd === 'string' && input.cwd) || process.cwd();
    line = renderLine({ cwd });
  } catch { line = 'sb'; }
  process.stdout.write(line + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
