// Feature modules are optional seams the hooks call through dynamic import, so each can be developed and tested alone:
//   digest.mjs     export async function digest(ctx)      -> additionalContext string | null      (SessionStart)
//   inbox.mjs      export async function inbox(ctx)       -> { additionalContext, systemMessage } | null   (UserPromptSubmit)
//   collision.mjs  export async function collision(ctx, toolInput) -> hookSpecificOutput fields | null  (PreToolUse)
//   contracts.mjs  export async function contractAlert(ctx, toolInput) -> string | null           (PostToolUse)
//   handoff.mjs    export async function stageHandoff(ctx, input) -> void                         (Stop)
//   seats.mjs      export function seatsNotice(snapshot, now) -> string | null                    (status command)
// ctx is the hook context from lib/hooks/context.mjs plus { snapshot } (parsed snapshot.json or null).
export const FEATURE_SEAMS = ['digest', 'inbox', 'collision', 'contracts', 'handoff', 'seats'];
