// Rebuild this developer's published state from the local journal (ADR-001 section 1). Every tick regenerates the whole
// tree from local truth, so a rejected push, a force push by someone else, or a week offline all heal by themselves.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { LIMITS, SCHEMA_VERSION, isHandle, isDevice, validRepoPath, validBranch, isTaskId } from '../core/schema.mjs';
import { readEvents } from './journal.mjs';
import { paths } from './layout.mjs';
import { logLine } from '../core/log.mjs';
import { sanitizeLine, sanitizeText } from '../safety/sanitize.mjs';
import { redact } from '../safety/redact.mjs';

const EDIT_WINDOW_MS = 30 * 60 * 1000;
const CONTRACT_WINDOW_MS = 48 * 60 * 60 * 1000;
const HANDOFF_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const STATUSES = new Set(['open', 'in-progress', 'done', 'blocked']);

const ms = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : 0; };
const clean = (text, max) => sanitizeLine(redact(String(text ?? '')).text, max);

/** A task summary when the developer has not written one: the branch name, humanized. */
export function summaryFromBranch(branch) {
  if (!branch || branch === 'HEAD') return '';
  const tail = String(branch).split('/').slice(-1)[0].replace(/[-_]+/g, ' ').replace(/\b(\d{2,})\b/g, '#$1').trim();
  return tail ? clean(tail, LIMITS.task) : '';
}

function foldClaims(events, now) {
  const open = new Map();
  for (const ev of events) {
    if (ev.type === 'claim') {
      const p = ev.path ? validRepoPath(ev.path) : null;
      const task = ev.task && isTaskId(ev.task) ? ev.task : null;
      if (!p && !task) continue;
      const key = p || `task:${task}`;
      open.set(key, { id: typeof ev.id === 'string' ? ev.id.slice(0, 26) : null, path: p, task, at: ev.t, ttlMs: LIMITS.claimTtlMs, note: clean(ev.note || '', LIMITS.task) });
    } else if (ev.type === 'release') {
      if (!ev.path && !ev.task && !ev.id) { open.clear(); continue; }
      const p = ev.path ? validRepoPath(ev.path) : null;
      const key = p || (ev.task ? `task:${ev.task}` : null);
      if (key) open.delete(key);
      else if (ev.id) for (const [k, v] of open) if (v.id === ev.id) open.delete(k);
    }
  }
  return [...open.values()].filter((c) => now - ms(c.at) < c.ttlMs).slice(-LIMITS.claimsPerWriter);
}

function foldBoardOps(events) {
  const tasks = new Map();
  for (const ev of events) {
    if (ev.type !== 'board' || !ev.task || !isTaskId(ev.task.id)) continue;
    const prev = tasks.get(ev.task.id) || { id: ev.task.id, title: '', status: 'open', owner: null, deps: [] };
    const next = { ...prev, updatedAt: ev.t };
    if (typeof ev.task.title === 'string' && ev.task.title) next.title = clean(ev.task.title, LIMITS.title);
    if (Array.isArray(ev.task.deps)) next.deps = ev.task.deps.filter(isTaskId).slice(0, LIMITS.deps);
    if (ev.op === 'add') next.status = 'open';
    if (ev.op === 'take') { next.status = 'in-progress'; next.owner = isHandle(ev.task.owner) ? ev.task.owner : prev.owner; }
    if (ev.op === 'done') next.status = 'done';
    if (typeof ev.task.status === 'string' && STATUSES.has(ev.task.status)) next.status = ev.task.status;
    tasks.set(next.id, next);
  }
  return [...tasks.values()].slice(-50);
}

function recentEditPaths(events, now) {
  const seen = new Map();
  for (const ev of events) {
    if (ev.type !== 'edit') continue;
    const p = validRepoPath(ev.path || '');
    if (!p || now - ms(ev.t) > EDIT_WINDOW_MS) continue;
    seen.set(p, ev.t);
  }
  return [...seen.entries()].slice(-30).map(([p, at]) => ({ path: p, at }));
}

/** The shared directory prefix of the paths edited recently, used as a coarse "area" in presence. */
function areaOf(edits) {
  if (!edits.length) return null;
  const dirs = edits.map((e) => (e.path.includes('/') ? e.path.slice(0, e.path.lastIndexOf('/')) : ''));
  let common = dirs[0];
  for (const d of dirs.slice(1)) {
    const a = common.split('/');
    const b = d.split('/');
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    common = a.slice(0, i).join('/');
  }
  return common ? validRepoPath(common) : null;
}

/**
 * Build the files this developer publishes. Returns { tree, hash, presence } where tree maps a file name to its JSON text.
 * Nothing here reads the network or runs git; the caller supplies handle, device, branch and an optional task summary.
 */
export function buildOwnTree({ checkoutDir, handle, device, branch = null, task = '', sessionStartedAt = null, pluginVersion = null, now = Date.now(), events = null }) {
  if (!isHandle(handle) || !isDevice(device)) return null;
  const list = events || readEvents(checkoutDir);
  const br = validBranch(branch) || null;
  const summaryEvent = [...list].reverse().find((e) => e.type === 'task-summary' && typeof e.text === 'string' && e.text.trim());
  const lastActivity = [...list].reverse().find((e) => ['edit', 'prompt', 'task-summary', 'claim', 'notify', 'board'].includes(e.type));
  const edits = recentEditPaths(list, now);
  const presence = {
    handle,
    device,
    branch: br,
    task: clean(task || (summaryEvent ? summaryEvent.text : '') || summaryFromBranch(br), LIMITS.task),
    area: areaOf(edits),
    lastSeen: (lastActivity && lastActivity.t) || new Date(now).toISOString(),
    sessionStartedAt: sessionStartedAt || null,
    pluginVersion: pluginVersion || null,
    edits,
  };
  const tree = {
    'manifest.json': JSON.stringify({ handle, device, schemaVersion: SCHEMA_VERSION }),
    'presence.json': JSON.stringify(presence),
    'claims.json': JSON.stringify(foldClaims(list, now)),
    'board.json': JSON.stringify(foldBoardOps(list)),
    'contracts.json': JSON.stringify(list
      .filter((e) => e.type === 'contract-change' && now - ms(e.t) < CONTRACT_WINDOW_MS)
      .map((e) => ({ path: validRepoPath(e.path || ''), symbols: Array.isArray(e.symbols) ? e.symbols.slice(0, 20) : [], at: e.t }))
      .filter((c) => c.path)
      .slice(-20)),
  };
  for (const ev of list) {
    if (ev.type === 'notify' && ev.id && isHandle(ev.to) && now - ms(ev.t) < LIMITS.messageTtlMs) {
      tree[`messages/${ev.id}.json`] = JSON.stringify({ id: ev.id, from: handle, to: ev.to, at: ev.t, text: sanitizeText(redact(String(ev.text || '')).text) });
    }
    if (ev.type === 'handoff' && ev.handoff && now - ms(ev.t) < HANDOFF_WINDOW_MS) {
      const id = ev.handoff.id || ev.id;
      if (id) tree[`handoffs/${id}.json`] = JSON.stringify({ ...ev.handoff, id, from: handle, at: ev.handoff.at || ev.t });
    }
  }
  const names = Object.keys(tree).sort();
  const extra = names.length - LIMITS.filesPerWriter;
  if (extra > 0) for (const name of names.filter((n) => n.startsWith('messages/') || n.startsWith('handoffs/')).slice(0, extra)) delete tree[name];
  const digest = crypto.createHash('sha256');
  for (const key of Object.keys(tree).sort()) digest.update(`${key}:${tree[key]}\n`);
  return { tree, hash: digest.digest('hex').slice(0, 16), presence };
}

/** Write the tree under own/ too, so a developer can read exactly what is published. */
export function writeOwnTree(checkoutDir, tree) {
  const dir = paths.checkout(checkoutDir).own;
  try {
    fs.mkdirSync(path.join(dir, 'messages'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'handoffs'), { recursive: true });
    const wanted = new Set(Object.keys(tree));
    for (const sub of ['', 'messages', 'handoffs']) {
      const here = path.join(dir, sub);
      for (const entry of fs.readdirSync(here, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const rel = sub ? `${sub}/${entry.name}` : entry.name;
        if (!wanted.has(rel)) { try { fs.unlinkSync(path.join(here, entry.name)); } catch { /* raced */ } }
      }
    }
    for (const [rel, text] of Object.entries(tree)) fs.writeFileSync(path.join(dir, rel), text);
    return true;
  } catch (err) { logLine('own', `write failed: ${err && err.message}`); return false; }
}
