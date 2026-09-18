// PostToolUse (Edit|Write|NotebookEdit): portability guard on the edited file (Phase 3) and contract alerts (Phase 6).
// Both parts are advisory; either may be absent or fail, and the hook then simply says less.
import { hookContext } from './context.mjs';
import { readJson } from '../core/fsx.mjs';
import { after } from '../guard/index.mjs';

export async function run(input) {
  const c = hookContext(input);
  if (!c.loc) return null;
  const toolInput = input && input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  const toolResponse = input && input.tool_response && typeof input.tool_response === 'object' ? input.tool_response : null;
  const parts = [];
  const guard = await after(c, toolInput, toolResponse);
  if (guard && guard.hookSpecificOutput && guard.hookSpecificOutput.additionalContext) parts.push(guard.hookSpecificOutput.additionalContext);
  try {
    // Optional seam (lib/features/README.mjs). The raw snapshot is untrusted; the seam validates it through lib/core/schema.mjs.
    const m = await import('../features/contracts.mjs');
    const alert = await m.contractAlert({ ...c, snapshot: c.snapshotFile ? readJson(c.snapshotFile, null) : null }, toolInput);
    if (typeof alert === 'string' && alert.trim()) parts.push(alert.trim());
  } catch { /* seam not present yet, or it failed: nothing to add */ }
  if (parts.length === 0) return null;
  return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: parts.join('\n\n') } };
}
