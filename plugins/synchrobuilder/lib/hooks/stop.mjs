// Stop: stage a handoff from this session's own events. SessionEnd only has 1.5 s, so the work happens here.
import { hookContext, writeSession } from './context.mjs';
import { logLine } from '../core/log.mjs';

export async function run(input) {
  const c = hookContext(input);
  if (!c.loc) return null;
  writeSession(c, { lastStopAt: new Date().toISOString() });
  try {
    const { stageHandoff } = await import('../features/handoff.mjs');
    await stageHandoff(c, input);
  } catch (err) { logLine('hooks', `stop: handoff ${err && err.message}`); }
  return null;
}
