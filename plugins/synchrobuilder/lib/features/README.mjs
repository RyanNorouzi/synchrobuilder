// Feature modules are optional seams the hooks call through dynamic import, so each can be developed and tested alone:
//   digest.mjs     export async function digest(ctx)      -> additionalContext string | null      (SessionStart)
//   inbox.mjs      export async function inbox(ctx)       -> { hookSpecificOutput: { hookEventName, additionalContext }, systemMessage } | null   (UserPromptSubmit)
//   collision.mjs  export async function collision(ctx, toolInput) -> { hookSpecificOutput: {...}, systemMessage } | null  (PreToolUse)
//   contracts.mjs  export async function contractAlert(ctx, toolInput) -> string | null           (PostToolUse)
//   handoff.mjs    export async function stageHandoff(ctx, input) -> draft | null                 (Stop)
//   seats.mjs      export function seatsNotice(snapshot, now, stateFile, { noticeEveryDays }) -> string | null   (status command only)
// ctx is the hook context from lib/hooks/context.mjs plus { snapshot } (parsed snapshot.json or null); every feature re-validates
// the snapshot through lib/core/schema.mjs (common.mjs normalizeSnapshot) and accepts ctx.now (ms) for deterministic tests.
// Supporting modules: common.mjs (identity, snapshot, staleness, paths), presence.mjs, board-fold.mjs, claims.mjs, seen.mjs,
// budget.mjs (priority-ordered rendering under a character limit), journal-write.mjs (append + kick, tail reader), symbols.mjs.
export const FEATURE_SEAMS = ['digest', 'inbox', 'collision', 'contracts', 'handoff', 'seats'];
