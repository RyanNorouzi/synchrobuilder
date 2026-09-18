// SessionEnd: mark the session closed. Everything slow belongs to the worker (1.5 s budget for plugin hooks).
import { hookContext, writeSession } from './context.mjs';
export async function run(input) {
  const c = hookContext(input);
  if (!c.loc) return null;
  writeSession(c, { closed: true, closedAt: new Date().toISOString(), reason: typeof input.reason === 'string' ? input.reason.slice(0, 40) : null });
  return null;
}
