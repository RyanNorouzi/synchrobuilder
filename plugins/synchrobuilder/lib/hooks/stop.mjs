// Stop: stage the handoff from local session events (Phase 6).
import { hookContext, writeSession } from './context.mjs';
export async function run(input) {
  const c = hookContext(input);
  if (!c.loc) return null;
  writeSession(c, { lastStopAt: new Date().toISOString() });
  return null;
}
