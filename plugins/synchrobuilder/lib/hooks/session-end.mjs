// SessionEnd: mark the session closed and ask the worker to publish. Plugin hooks share a 1.5 s budget here.
import { hookContext, writeSession } from './context.mjs';
import { appendEvent } from '../state/journal.mjs';
import { paths } from '../state/layout.mjs';
import { touch } from '../core/fsx.mjs';

export async function run(input) {
  const c = hookContext(input);
  if (!c.loc) return null;
  writeSession(c, { closed: true, closedAt: new Date().toISOString(), reason: typeof input.reason === 'string' ? input.reason.slice(0, 40) : null });
  try { appendEvent(c.loc.checkoutDir, { type: 'session-end', sid: c.sessionId }); } catch { /* fail open */ }
  try { touch(paths.checkout(c.loc.checkoutDir).kick); } catch { /* fail open */ }
  return null;
}
