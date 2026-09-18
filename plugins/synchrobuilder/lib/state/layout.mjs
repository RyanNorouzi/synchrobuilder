// Local state layout under ~/.synchrobuilder (ADR-001 section 6, ADR-002). Every path helper lives here so no module hard-codes names.
//
// ~/.synchrobuilder/
//   device.json                        { device: '3f9a1c2e', createdAt }
//   logs/<channel>.log
//   checkouts/<checkoutKey>/
//     link.json                        { commonDir, workTree, remoteUrl, repoName, pluginVersion, updatedAt }   (session-start)
//     identity.json                    { handle, device, source: 'team.json'|'override'|'provisional', email?, resolvedAt }   (worker or iam)
//     mute                             flag file (mute command)
//     journal.jsonl                    one JSON object per line: { t: iso, type, sid, ...fields }   (hooks and CLI append; worker reads)
//     own/presence.json, own/claims.json, own/board.json, own/contracts.json, own/messages/<ulid>.json, own/handoffs/<ulid>.json
//                                      the writer's current state, rebuilt by the worker from the journal; published verbatim
//     sessions/<sid>.json              { sessionId, pid, startedAt, lastSeenAt, closed, ... }
//     kick                             touch to request an immediate sync tick
//     warned.json                      collision throttle: { '<path>': isoTimeLastWarned }
//     handoff-draft.json               staged handoff for this session (stop hook)
//   remotes/<remoteKey>/
//     state.git/                       hidden bare repository (git runner only)
//     snapshot.json                    { schemaVersion, fetchedAt, transport, writers: [...] }   (worker writes atomically; hooks read)
//     status.json                      { mode, lastError, lastErrorClass, lastOkAt, nextAttemptAt, workerPid }
//     worker.lock/                     directory lock with pid + heartbeat files
import path from 'node:path';
import { homeDir } from '../core/paths.mjs';

export const JOURNAL_TYPES = Object.freeze([
  'session-start', 'session-end', 'prompt', 'edit', 'claim', 'release', 'notify', 'board', 'handoff', 'contract-change', 'task-summary',
]);

export const paths = {
  device: () => path.join(homeDir(), 'device.json'),
  checkout: (checkoutDir) => ({
    link: path.join(checkoutDir, 'link.json'),
    identity: path.join(checkoutDir, 'identity.json'),
    mute: path.join(checkoutDir, 'mute'),
    journal: path.join(checkoutDir, 'journal.jsonl'),
    own: path.join(checkoutDir, 'own'),
    sessions: path.join(checkoutDir, 'sessions'),
    kick: path.join(checkoutDir, 'kick'),
    warned: path.join(checkoutDir, 'warned.json'),
    handoffDraft: path.join(checkoutDir, 'handoff-draft.json'),
  }),
  remote: (remoteDir) => ({
    repo: path.join(remoteDir, 'state.git'),
    snapshot: path.join(remoteDir, 'snapshot.json'),
    status: path.join(remoteDir, 'status.json'),
    lock: path.join(remoteDir, 'worker.lock'),
  }),
};

/** snapshot.json writer entry shape (what hooks and features read):
 * { handle, device, sha, firstSeenAt, verified: 'yes'|'unknown-handle'|'email-mismatch'|'manifest-mismatch',
 *   presence, claims, messages, handoffs, board, contracts }   -- every field already validated by lib/core/schema.mjs
 */
export const SNAPSHOT_SCHEMA_VERSION = 1;
