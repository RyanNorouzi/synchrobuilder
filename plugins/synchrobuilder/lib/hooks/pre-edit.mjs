// PreToolUse (Edit|Write|NotebookEdit): snapshot the file for the guard, then warn about a teammate's claim. Advisory only.
import { hookContext } from './context.mjs';
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
    const { collision } = await import('../features/collision.mjs');
    return await collision(c, toolInput);
  } catch (err) { logLine('hooks', `pre-edit: collision ${err && err.message}`); }
  return null;
}
