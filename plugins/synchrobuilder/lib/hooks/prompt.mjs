// UserPromptSubmit: heartbeat, record a short task summary, and deliver teammate messages addressed to this developer.
import { hookContext, writeSession, readSession } from './context.mjs';
import { appendEvent } from '../state/journal.mjs';
import { LIMITS } from '../core/schema.mjs';
import { logLine } from '../core/log.mjs';

const HEARTBEAT_MS = 30_000;

export async function run(input) {
  const c = hookContext(input);
  if (!c.loc) return null;
  const session = readSession(c);
  const last = session && session.lastPromptAt ? Date.parse(session.lastPromptAt) : 0;
  const now = Date.now();
  if (!Number.isFinite(last) || now - last > HEARTBEAT_MS) {
    writeSession(c, { lastPromptAt: new Date(now).toISOString() });
    try { appendEvent(c.loc.checkoutDir, { type: 'prompt', sid: c.sessionId }); } catch { /* fail open */ }
  }
  // The first line of the prompt is the developer's own words about what they are doing; it is redacted and capped
  // by the journal writer before it can become the 140-character task summary teammates see.
  if (typeof input.prompt === 'string' && input.prompt.trim()) {
    try { appendEvent(c.loc.checkoutDir, { type: 'task-summary', sid: c.sessionId, text: input.prompt.trim().split('\n')[0].slice(0, LIMITS.task) }); } catch { /* fail open */ }
  }
  try {
    const { inbox } = await import('../features/inbox.mjs');
    return await inbox(c);
  } catch (err) { logLine('hooks', `prompt: inbox ${err && err.message}`); }
  return null;
}
