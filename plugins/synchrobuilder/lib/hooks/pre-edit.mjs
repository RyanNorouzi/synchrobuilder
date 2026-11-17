// PreToolUse (Edit|Write|NotebookEdit): snapshot the file for the guard, take the lease on it (ADR-007), then warn about a
// teammate's claim. The lease is the only step that can refuse an edit; everything else is advisory.
import { hookContext, readSession, writeSession } from './context.mjs';
import { logLine } from '../core/log.mjs';

export async function run(input) {
  const c = hookContext(input);
  if (!c.loc) return null;
  const toolInput = input && input.tool_input ? input.tool_input : {};
  try {
    const { before } = await import('../guard/index.mjs');
    await before(c, toolInput);
  } catch (err) { logLine('hooks', `pre-edit: guard ${err && err.message}`); }
  try {
    // A lease is only as alive as the session that took it, and liveness is the session file's pid. A session
    // that began before the plugin was installed has no such file, so its leases would count as dead on arrival.
    const session = readSession(c);
    if (c.sessionFile && (!session || !Number.isInteger(session.pid))) writeSession(c, { pid: process.ppid || null, closed: false });
    const { leaseGuard } = await import('../features/lease-guard.mjs');
    const held = await leaseGuard(c, toolInput);
    if (held) return held;
  } catch (err) { logLine('hooks', `pre-edit: lease ${err && err.message}`); }
  try {
    const { collision } = await import('../features/collision.mjs');
    return await collision(c, toolInput);
  } catch (err) { logLine('hooks', `pre-edit: collision ${err && err.message}`); }
  return null;
}
