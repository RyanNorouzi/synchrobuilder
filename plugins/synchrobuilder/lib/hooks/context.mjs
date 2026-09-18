// Per-hook context: where are we, are we muted, which session is this. File reads only; never throws.
import path from 'node:path';
import { locate, isMuted } from '../core/paths.mjs';
import { readJson, writeJsonAtomic } from '../core/fsx.mjs';

export function hookContext(input) {
  const cwd = input && typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
  const loc = locate(cwd);
  const sessionId = input && typeof input.session_id === 'string' ? input.session_id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) : '';
  return {
    cwd, loc, sessionId,
    muted: loc ? isMuted(loc.checkoutDir) : false,
    permissionMode: input && typeof input.permission_mode === 'string' ? input.permission_mode : 'default',
    sessionFile: loc && sessionId ? path.join(loc.checkoutDir, 'sessions', `${sessionId}.json`) : null,
    snapshotFile: loc && loc.remoteDir ? path.join(loc.remoteDir, 'snapshot.json') : null,
  };
}

export function readSession(ctx) { return ctx.sessionFile ? readJson(ctx.sessionFile, null) : null; }

export function writeSession(ctx, patch) {
  if (!ctx.sessionFile) return null;
  const current = readSession(ctx) || { sessionId: ctx.sessionId, startedAt: new Date().toISOString(), events: 0 };
  const next = { ...current, ...patch, lastSeenAt: new Date().toISOString() };
  try { writeJsonAtomic(ctx.sessionFile, next); } catch { /* fail open */ }
  return next;
}
