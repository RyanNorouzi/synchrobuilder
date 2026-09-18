// Turns raw transport writers ({ handle, device, sha, files: { relPath: Buffer } }) into validated snapshot writer entries
// (lib/state/layout.mjs). Every document goes through lib/core/schema.mjs and every free-text field through the sanitizer here,
// at sync time, because a compromised writer bypasses any writer-side step (ADR-005 section 1). Never throws.
import { LIMITS, RE, validManifest, validPresence, validClaims, validMessage, validBoard, validHandoff, validContracts } from '../core/schema.mjs';
import { sanitizeLine, sanitizeText } from '../safety/sanitize.mjs';
import { logLine } from '../core/log.mjs';

export const VERIFIED = Object.freeze(['yes', 'unknown-handle', 'email-mismatch', 'manifest-mismatch']);
const MAX_MESSAGES = 50;
const MAX_HANDOFFS = 10;

function parseJson(buf) {
  try { return JSON.parse(Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf)); } catch { return undefined; }
}

/** Trust label for one writer: manifest must match the ref, handle must be a team member, author email must be the default or listed. */
export function verifyWriter(writer, manifest, team) {
  if (!manifest || manifest.handle !== writer.handle || manifest.device !== writer.device) return 'manifest-mismatch';
  const members = team && team.members && typeof team.members === 'object' ? team.members : null;
  // A repo without team.json runs on provisional handles (ADR-002 section 3), so there is no membership to check.
  if (!members || Object.keys(members).length === 0) return 'yes';
  const member = members[writer.handle];
  if (!member) return 'unknown-handle';
  const email = typeof writer.email === 'string' ? writer.email.trim().toLowerCase() : '';
  if (!email) return 'yes';
  const allowed = new Set([`${writer.handle}@synchrobuilder.invalid`, ...(Array.isArray(member.emails) ? member.emails.map((e) => String(e).toLowerCase()) : [])]);
  return allowed.has(email) ? 'yes' : 'email-mismatch';
}

function cleanPresence(p, writer, receiptMs) {
  const v = validPresence(p, receiptMs);
  if (!v || v.handle !== writer.handle || v.device !== writer.device) return null;
  return { ...v, task: sanitizeLine(v.task, LIMITS.task) };
}

function cleanClaims(c, receiptMs) {
  return validClaims(c, receiptMs).map((claim) => ({ ...claim, note: sanitizeLine(claim.note, LIMITS.task) }));
}

function cleanBoard(b, receiptMs) {
  return validBoard(b, receiptMs).map((t) => ({ ...t, title: sanitizeLine(t.title, LIMITS.title) }));
}

/** messages/<ulid>.json: the sender must be the writer itself; the file name supplies a missing id. */
function cleanMessage(m, fileId, writer, receiptMs) {
  const v = validMessage(m, receiptMs);
  if (!v || v.from !== writer.handle) return null;
  return { ...v, id: v.id || fileId, text: sanitizeText(v.text, { maxChars: LIMITS.message, maxLines: LIMITS.messageLines }) };
}

function cleanHandoff(h, fileId, writer, receiptMs) {
  const v = validHandoff(h, receiptMs);
  if (!v || v.from !== writer.handle) return null;
  const lines = (arr) => arr.map((s) => sanitizeLine(s, LIMITS.task)).filter(Boolean);
  return { ...v, id: v.id || fileId, task: sanitizeLine(v.task, LIMITS.task), done: lines(v.done), interfaces: lines(v.interfaces), decisions: lines(v.decisions), blockers: lines(v.blockers), next: lines(v.next) };
}

function idFromName(rel, dir) {
  const m = rel.match(new RegExp(`^${dir}/([0-9A-HJKMNP-TV-Z]{26})\\.json$`));
  return m && RE.ulid.test(m[1]) ? m[1] : null;
}

/** One validated snapshot entry for one raw writer. */
export function parseWriter(writer, { team = null, receiptMs = Date.now() } = {}) {
  const files = writer && writer.files && typeof writer.files === 'object' ? writer.files : {};
  const manifest = validManifest(parseJson(files['manifest.json']));
  const entry = {
    handle: writer.handle, device: writer.device, sha: writer.sha, namespace: writer.namespace || null,
    firstSeenAt: new Date(receiptMs).toISOString(),
    verified: verifyWriter(writer, manifest, team),
    schemaVersion: manifest ? manifest.schemaVersion : 0,
    presence: null, claims: [], messages: [], handoffs: [], board: [], contracts: [],
  };
  if (files['presence.json']) entry.presence = cleanPresence(parseJson(files['presence.json']), writer, receiptMs);
  if (files['claims.json']) entry.claims = cleanClaims(parseJson(files['claims.json']), receiptMs);
  if (files['board.json']) entry.board = cleanBoard(parseJson(files['board.json']), receiptMs);
  if (files['contracts.json']) entry.contracts = validContracts(parseJson(files['contracts.json']), receiptMs);
  for (const rel of Object.keys(files).sort()) {
    const msgId = idFromName(rel, 'messages');
    const hoId = idFromName(rel, 'handoffs');
    if (msgId && entry.messages.length < MAX_MESSAGES) {
      const m = cleanMessage(parseJson(files[rel]), msgId, writer, receiptMs);
      if (m) entry.messages.push(m);
    } else if (hoId && entry.handoffs.length < MAX_HANDOFFS) {
      const h = cleanHandoff(parseJson(files[rel]), hoId, writer, receiptMs);
      if (h) entry.handoffs.push(h);
    }
  }
  return entry;
}

/** All writers -> validated entries. Writers whose ref name is malformed are dropped; everything else is kept with a `verified` label. */
export function parseWriters(writers, { team = null, receiptMs = Date.now() } = {}) {
  const out = [];
  for (const w of Array.isArray(writers) ? writers : []) {
    try {
      if (!w || !RE.handle.test(String(w.handle)) || !RE.device.test(String(w.device))) continue;
      out.push(parseWriter(w, { team, receiptMs }));
    } catch (err) {
      logLine('transport', `reader: dropped writer ${w && w.handle}/${w && w.device}: ${err && err.message}`);
    }
  }
  return out;
}
