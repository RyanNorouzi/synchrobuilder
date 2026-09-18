// Reads the two committed team files. Both are optional; defaults keep everything working in a repo that has neither.
//   .synchrobuilder/team.json   { version: 1, members: { alice: { name, emails: [] } } }
//   .synchrobuilder/config.json { version: 1, collision: { mode: 'warn'|'ask', windowMinutes: 30 }, contracts: { paths: [globs] }, audit: { ignore: [globs], strict: false }, transport: { remote: 'origin', namespace: 'custom'|'branch' } }
import path from 'node:path';
import { readJson } from './fsx.mjs';
import { isHandle } from './schema.mjs';

export const DEFAULT_CONFIG = Object.freeze({
  version: 1,
  collision: { mode: 'warn', windowMinutes: 30 },
  contracts: { paths: ['**/contracts/**', '**/*.schema.*', '**/openapi.*', '**/prisma/schema.prisma', '**/*.proto', '**/types/**'] },
  audit: { ignore: [], strict: false },
  transport: { remote: 'origin', namespace: 'custom', intervalSeconds: 45 },
  seats: { noticeEveryDays: 7 },
});

export function readTeam(workTree) {
  const raw = readJson(path.join(workTree, '.synchrobuilder', 'team.json'), null);
  const members = {};
  if (raw && raw.members && typeof raw.members === 'object') {
    for (const [handle, m] of Object.entries(raw.members)) {
      if (!isHandle(handle) || !m || typeof m !== 'object') continue;
      members[handle] = { name: typeof m.name === 'string' ? m.name.slice(0, 80) : handle, emails: Array.isArray(m.emails) ? m.emails.filter((e) => typeof e === 'string').map((e) => e.trim().toLowerCase()).slice(0, 8) : [] };
    }
  }
  return { version: raw && Number.isInteger(raw.version) ? raw.version : 1, members, present: raw !== null };
}

export function readConfig(workTree) {
  const raw = readJson(path.join(workTree, '.synchrobuilder', 'config.json'), null) || {};
  const merge = (d, r) => ({ ...d, ...(r && typeof r === 'object' && !Array.isArray(r) ? r : {}) });
  const cfg = {
    version: 1,
    collision: merge(DEFAULT_CONFIG.collision, raw.collision),
    contracts: merge(DEFAULT_CONFIG.contracts, raw.contracts),
    audit: merge(DEFAULT_CONFIG.audit, raw.audit),
    transport: merge(DEFAULT_CONFIG.transport, raw.transport),
    seats: merge(DEFAULT_CONFIG.seats, raw.seats),
  };
  if (cfg.collision.mode !== 'ask') cfg.collision.mode = 'warn';
  if (!Number.isInteger(cfg.collision.windowMinutes) || cfg.collision.windowMinutes < 1) cfg.collision.windowMinutes = 30;
  if (!Array.isArray(cfg.contracts.paths)) cfg.contracts.paths = [...DEFAULT_CONFIG.contracts.paths];
  if (!Array.isArray(cfg.audit.ignore)) cfg.audit.ignore = [];
  return cfg;
}

// Minimal glob matcher for repo-relative POSIX paths: supports double-star, star, ? and a leading double-star-slash meaning "at any depth".
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { i++; if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*'; }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export function matchesAny(relPath, globs) {
  return (globs || []).some((g) => globToRegExp(g).test(relPath));
}
