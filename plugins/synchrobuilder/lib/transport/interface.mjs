// Transport interface (ADR-001 section 7). GitRefsTransport implements it in v1; a hosted hub could later.
// All methods are async, never throw, and report problems through the returned status object.
//
//   probe()          -> { mode: 'custom' | 'branch' | 'readonly' | 'local', detail: string }
//   publish(tree)    -> { ok, sha, status }      tree: { 'presence.json': string|Buffer, 'claims.json': ..., 'messages/<ulid>.json': ... }
//   pull()           -> { ok, writers: [{ handle, device, sha, files: { relPath: Buffer } }], status }
//   status()         -> { mode, lastError, lastErrorClass, lastOkAt, nextAttemptAt }
//
// Error classes used everywhere: 'rejected' | 'no-ref' | 'auth' | 'policy' | 'network' | 'ssh-hostkey' | 'unknown'.
export const ERROR_CLASSES = Object.freeze(['rejected', 'no-ref', 'auth', 'policy', 'network', 'ssh-hostkey', 'unknown']);
export const REF_NAMESPACE = 'refs/synchrobuilder/v1';
export const BRANCH_NAMESPACE = 'refs/heads/synchrobuilder/v1';
export const LOCAL_CUSTOM = 'refs/sb-remote/custom/v1';
export const LOCAL_HEADS = 'refs/sb-remote/heads/v1';

export class Transport {
  async probe() { return { mode: 'local', detail: 'not implemented' }; }
  async publish() { return { ok: false, sha: null, status: { lastErrorClass: 'unknown', lastError: 'not implemented' } }; }
  async pull() { return { ok: false, writers: [], status: { lastErrorClass: 'unknown', lastError: 'not implemented' } }; }
  status() { return { mode: 'local', lastError: null, lastErrorClass: null, lastOkAt: null, nextAttemptAt: null }; }
}

/** Classify a git stderr/stdout blob into an error class. Shared by the git transport and the doctor. */
export function classifyGitError(text) {
  const t = String(text || '');
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(t)) return 'ssh-hostkey';
  if (/Authentication failed|Permission denied \(publickey|could not read Username|403|401|terminal prompts disabled|Invalid username or (password|token)/i.test(t)) return 'auth';
  if (/cannot lock ref|failed to update ref|is at .* but expected|stale info|non-fast-forward|fetch first|failed to lock/i.test(t)) return 'rejected';
  if (/denying non-fast-forward|deletion prohibited|protected branch|pre-receive hook declined|GH006|GH013|refusing to (update|create)|push declined|remote rejected/i.test(t)) return 'policy';
  if (/couldn't find remote ref|no such ref|unknown revision|not our ref/i.test(t)) return 'no-ref';
  if (/Could not resolve host|Couldn't connect|Connection (refused|timed out|reset)|unable to access|Network is unreachable|Operation timed out|early EOF|The remote end hung up/i.test(t)) return 'network';
  return 'unknown';
}
