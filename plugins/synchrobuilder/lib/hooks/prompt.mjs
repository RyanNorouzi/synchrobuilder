// UserPromptSubmit: heartbeat the session; deliver teammate messages from the local snapshot (Phase 6).
import { hookContext, writeSession } from './context.mjs';
export async function run(input) {
  const c = hookContext(input);
  if (!c.loc) return null;
  writeSession(c, {});
  return null;
}
