// Shared state schemas and validators (ADR-001 data model, ADR-005 identifier rules).
// Validators return a normalized value or null; they never throw and never "clean" identifiers into validity.

export const SCHEMA_VERSION = 1;
export const LIMITS = Object.freeze({
  handle: 32, device: 8, branch: 128, path: 512, pathSegments: 64, task: 140, message: 400, messageLines: 6, lineChars: 200,
  title: 100, taskId: 40, symbol: 80, deps: 10, claimsPerWriter: 50, claimTtlMs: 4 * 3600 * 1000, messageTtlMs: 72 * 3600 * 1000,
  digestChars: 6000, inboxChars: 2000, collisionChars: 600, alertChars: 1500, blobBytes: 64 * 1024, filesPerWriter: 20, bytesPerSync: 1024 * 1024,
});

export const RE = Object.freeze({
  handle: /^[a-z0-9][a-z0-9-]{0,31}$/,
  device: /^[a-f0-9]{8}$/,
  branch: /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/,
  taskId: /^[a-z0-9][a-z0-9-]{0,39}$/,
  symbol: /^[A-Za-z_$][A-Za-z0-9_$.:#-]{0,79}$/,
  ulid: /^[0-9A-HJKMNP-TV-Z]{26}$/,
  isoZ: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/,
  control: /[\x00-\x1f\x7f-\x9f]/,
  format: /\p{Cf}/u,
});

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

export function isHandle(s) { return typeof s === 'string' && RE.handle.test(s); }
export function isDevice(s) { return typeof s === 'string' && RE.device.test(s); }
export function isTaskId(s) { return typeof s === 'string' && RE.taskId.test(s); }
export function isSymbol(s) { return typeof s === 'string' && RE.symbol.test(s); }

export function validBranch(s) {
  if (typeof s !== 'string' || !RE.branch.test(s)) return null;
  if (s.includes('..') || s.includes('//') || s.endsWith('/') || s.endsWith('.lock')) return null;
  return s;
}

/** Repo-relative path from a teammate: relative, forward slashes, no traversal, no control or format characters. */
export function validRepoPath(s) {
  if (typeof s !== 'string' || s.length === 0 || s.length > LIMITS.path) return null;
  if (s.startsWith('/') || s.includes('\\') || /^[A-Za-z]:/.test(s)) return null;
  if (RE.control.test(s) || RE.format.test(s)) return null;
  const nfc = s.normalize('NFC');
  const segments = nfc.split('/');
  if (segments.length > LIMITS.pathSegments) return null;
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..') return null;
    if (WINDOWS_RESERVED.test(seg)) return null;
  }
  if (segments[0] === '.git' || (segments[0] === '.synchrobuilder' && segments[1] === 'state')) return null;
  return nfc;
}

/** Strict ISO-8601 Z timestamp within [2020-01-01, receipt + 5 min]; otherwise null (caller substitutes the receipt time). */
export function validTimestamp(s, receiptMs = Date.now()) {
  if (typeof s !== 'string' || !RE.isoZ.test(s)) return null;
  const t = Date.parse(s);
  if (!Number.isFinite(t) || t < Date.parse('2020-01-01T00:00:00Z') || t > receiptMs + 5 * 60 * 1000) return null;
  return new Date(t).toISOString();
}

export function nowIso() { return new Date().toISOString(); }

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Sortable unique id (ULID layout) without dependencies. */
export function ulid(nowMs = Date.now()) {
  let time = '';
  let t = nowMs;
  for (let i = 0; i < 10; i++) { time = CROCKFORD[t % 32] + time; t = Math.floor(t / 32); }
  let rand = '';
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  for (let i = 0; i < 16; i++) rand += CROCKFORD[bytes[i] % 32];
  return time + rand;
}

function plainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype; }
function str(v, max) { return typeof v === 'string' && v.length <= max ? v : null; }

/** presence.json */
export function validPresence(v, receiptMs = Date.now()) {
  if (!plainObject(v) || !isHandle(v.handle) || !isDevice(v.device)) return null;
  return {
    handle: v.handle, device: v.device,
    branch: validBranch(v.branch) || null,
    task: str(v.task, LIMITS.task * 4) || '',
    area: validRepoPath(v.area || '') || null,
    lastSeen: validTimestamp(v.lastSeen, receiptMs),
    sessionStartedAt: validTimestamp(v.sessionStartedAt, receiptMs),
    pluginVersion: str(v.pluginVersion, 32) || null,
  };
}

/** claims.json: array of { id, path?, task?, at, ttlMs?, note? } */
export function validClaims(v, receiptMs = Date.now()) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const c of v.slice(0, LIMITS.claimsPerWriter * 2)) {
    if (!plainObject(c)) continue;
    const p = c.path !== undefined ? validRepoPath(c.path) : null;
    const task = c.task !== undefined && isTaskId(c.task) ? c.task : null;
    if (!p && !task) continue;
    const at = validTimestamp(c.at, receiptMs);
    const ttlMs = Number.isInteger(c.ttlMs) && c.ttlMs > 0 ? Math.min(c.ttlMs, LIMITS.claimTtlMs) : LIMITS.claimTtlMs;
    out.push({ id: str(c.id, 26) || null, path: p, task, at, timeUnverified: !at, ttlMs, note: str(c.note, LIMITS.task * 4) || '' });
    if (out.length >= LIMITS.claimsPerWriter) break;
  }
  return out;
}

/** messages/<ulid>.json */
export function validMessage(v, receiptMs = Date.now()) {
  if (!plainObject(v) || !isHandle(v.from) || !isHandle(v.to) || typeof v.text !== 'string') return null;
  return { id: RE.ulid.test(v.id || '') ? v.id : null, from: v.from, to: v.to, at: validTimestamp(v.at, receiptMs), text: v.text.slice(0, LIMITS.message * 4), expiresAt: validTimestamp(v.expiresAt, receiptMs + LIMITS.messageTtlMs) };
}

/** board.json: array of { id, title, status, owner?, deps[], updatedAt } */
export function validBoard(v, receiptMs = Date.now()) {
  if (!Array.isArray(v)) return [];
  const STATUS = new Set(['open', 'in-progress', 'done', 'blocked']);
  const out = [];
  for (const t of v.slice(0, 200)) {
    if (!plainObject(t) || !isTaskId(t.id) || typeof t.title !== 'string') continue;
    const deps = Array.isArray(t.deps) ? [...new Set(t.deps.filter((d) => isTaskId(d) && d !== t.id))].slice(0, LIMITS.deps) : [];
    out.push({ id: t.id, title: t.title.slice(0, LIMITS.title * 4), status: STATUS.has(t.status) ? t.status : 'open', owner: isHandle(t.owner) ? t.owner : null, deps, updatedAt: validTimestamp(t.updatedAt, receiptMs) });
    if (out.length >= 50) break;
  }
  return out;
}

/** handoffs/<ulid>.json */
export function validHandoff(v, receiptMs = Date.now()) {
  if (!plainObject(v) || !isHandle(v.from)) return null;
  const list = (arr, max, f = (x) => str(x, LIMITS.task * 4)) => (Array.isArray(arr) ? arr.map(f).filter(Boolean).slice(0, max) : []);
  return {
    id: RE.ulid.test(v.id || '') ? v.id : null, from: v.from, at: validTimestamp(v.at, receiptMs),
    branch: validBranch(v.branch) || null, task: str(v.task, LIMITS.task * 4) || '',
    done: list(v.done, 10), files: list(v.files, 30, validRepoPath), interfaces: list(v.interfaces, 10), decisions: list(v.decisions, 10),
    blockers: list(v.blockers, 5), next: list(v.next, 10), for: list(v.for, 8, (h) => (isHandle(h) ? h : null)),
  };
}

/** contracts.json: array of { path, symbols[], at } */
export function validContracts(v, receiptMs = Date.now()) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const c of v.slice(0, 50)) {
    if (!plainObject(c)) continue;
    const p = validRepoPath(c.path);
    if (!p) continue;
    out.push({ path: p, symbols: Array.isArray(c.symbols) ? c.symbols.filter(isSymbol).slice(0, 20) : [], at: validTimestamp(c.at, receiptMs) });
    if (out.length >= 20) break;
  }
  return out;
}

export function validManifest(v) {
  if (!plainObject(v) || !isHandle(v.handle) || !isDevice(v.device)) return null;
  return { handle: v.handle, device: v.device, schemaVersion: Number.isInteger(v.schemaVersion) ? v.schemaVersion : 0 };
}
