// UserPromptSubmit inbox: unseen messages addressed to me, at most 5 per sender, identical repeats within 10 min dropped,
// nothing older than 72 h, from verified writers only (ADR-005 sections 5 and 6). Fits LIMITS.inboxChars.
import { LIMITS } from '../core/schema.mjs';
import { sanitizeText } from '../safety/sanitize.mjs';
import { nowMs, readIdentity, snapshotFromCtx, teammates, MS } from './common.mjs';
import { readSeen, writeSeen, messageKey } from './seen.mjs';
import { renderBudgeted } from './budget.mjs';

const PER_SENDER = 5;
const DEDUPE_MS = 10 * MS.minute;

/** Candidate messages for `me`, oldest first, after the policy filters. Exported for tests. */
export function selectMessages(snapshot, identity, seen, now) {
  const all = [];
  const delivered = []; // already-seen messages, so a repeat of one of them is not delivered on a later prompt either
  for (const w of teammates(snapshot, identity)) {
    if (w.verified !== 'yes') continue;
    for (const m of w.messages || []) {
      if (m.to !== identity.handle || m.from !== w.handle) continue;
      const at = Date.parse(m.at || w.firstSeenAt || '');
      if (!Number.isFinite(at) || now - at > LIMITS.messageTtlMs) continue;
      if (m.expiresAt && Date.parse(m.expiresAt) < now) continue;
      const key = messageKey(m);
      (seen.messages[key] ? delivered : all).push({ key, from: m.from, at, atIso: m.at, text: m.text, writer: w });
    }
  }
  all.sort((a, b) => a.at - b.at);
  const out = [];
  const perSender = new Map();
  const twin = (o, m) => o.from === m.from && o.text === m.text && Math.abs(o.at - m.at) < DEDUPE_MS;
  for (const m of all) {
    if (out.some((o) => twin(o, m)) || delivered.some((o) => twin(o, m))) continue;
    const n = perSender.get(m.from) || 0;
    if (n >= PER_SENDER) continue;
    perSender.set(m.from, n + 1);
    out.push(m);
  }
  return out;
}

export async function inbox(ctx) {
  if (!ctx || !ctx.loc || ctx.muted) return null;
  const now = nowMs(ctx);
  const identity = readIdentity(ctx.loc.checkoutDir);
  const snapshot = snapshotFromCtx(ctx);
  if (!identity || !snapshot) return null;
  const seen = readSeen(ctx.loc.checkoutDir);
  const messages = selectMessages(snapshot, identity, seen, now);
  if (!messages.length) return null;
  const entries = messages.map((m) => ({
    key: m.key, from: m.from,
    meta: { from: m.from, kind: 'message', to: 'me', at: m.atIso || 'withheld', seen: m.writer.firstSeenAt || 'withheld', verified: m.writer.verified },
    lines: sanitizeText(m.text).split('\n').filter(Boolean),
  })).filter((e) => e.lines.length);
  if (!entries.length) return null;
  const result = renderBudgeted({ kind: 'inbox', sections: [{ entries }], limit: LIMITS.inboxChars, generatedAt: new Date(now).toISOString() });
  if (!result) return null;
  const at = new Date(now).toISOString();
  const senders = [];
  for (const e of result.entries) { seen.messages[e.key] = at; if (!senders.includes(e.from)) senders.push(e.from); }
  writeSeen(ctx.loc.checkoutDir, seen, now); // messages dropped for budget stay unseen and arrive on the next prompt
  const n = result.kept;
  return {
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: result.text },
    systemMessage: `Synchrobuilder: ${n} message${n === 1 ? '' : 's'} from ${senders.join(', ')}`,
  };
}
