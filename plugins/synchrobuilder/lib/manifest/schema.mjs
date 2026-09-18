// synchrobuilder.json v1 validator (ADR-004, docs/manifest-spec.md). validateManifest never throws: it returns every problem it
// found so a user can fix the file in one pass. Nothing here reads the disk; io.mjs does that.
export const MANIFEST_VERSION = 1;
export const MANIFEST_FILE = 'synchrobuilder.json';
export const SCHEMA_URL = 'https://synchrobuilder.dev/schema/manifest-v1.json';
export const OS_NAMES = Object.freeze(['windows', 'macos', 'linux']);
export const KNOWN_COMMANDS = Object.freeze(['install', 'build', 'migrate', 'seed', 'start', 'test']);
const TOP_KEYS = Object.freeze(['$schema', 'version', 'name', 'runtimes', 'packageManager', 'services', 'env', 'commands', 'healthCheck', 'os']);
const LIMITS = Object.freeze({ name: 100, text: 500, items: 64, commandChars: 1000 });

// Exact versions only: "24.16.0", "3.12", "10.22.0-beta.1". Ranges (^ ~ > < * x ||) and bare majors are not exact.
const RE_EXACT_VERSION = /^\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.]+)?$/;
const RE_SERVICE_VERSION = /^\d+(?:\.\d+){0,3}(?:[-+][0-9A-Za-z.]+)?$/;
const RE_IDENT = /^[a-z][a-z0-9-]{0,39}$/;
const RE_ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const RE_CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/;

/** Returns a description of the first shell construct in a command string, or null when it is plain arguments. */
export function shellSyntaxIn(command) {
  const s = String(command);
  const checks = [
    [/&&/, '"&&" (command chaining)'], [/\|\|/, '"||" (command chaining)'], [/\|/, '"|" (a pipe)'], [/;/, '";" (command separator)'],
    [/>/, '">" (redirection)'], [/</, '"<" (redirection)'], [/`/, '"`" (command substitution)'], [/&/, '"&" (background operator)'],
    [/\$\{/, '"${VAR}" (variable expansion)'], [/\$\(/, '"$(...)" (command substitution)'], [/\$[A-Za-z_]/, '"$VAR" (variable expansion)'],
    [/[\r\n]/, 'a line break'],
  ];
  for (const [re, what] of checks) if (re.test(s)) return what;
  return null;
}

export function currentOs(platform = process.platform) {
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'macos';
  return 'linux';
}

function plain(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function text(v, max = LIMITS.text) { return typeof v === 'string' && v.length <= max && !RE_CONTROL.test(v); }

function unknownKeys(obj, allowed, where, errors) {
  for (const k of Object.keys(obj)) if (!allowed.includes(k) && !k.startsWith('x-')) errors.push(`${where}: unknown key "${k}" (extensions must start with "x-")`);
}

function checkCommand(value, where, errors) {
  if (typeof value !== 'string' || !value.trim()) { errors.push(`${where}: must be a non-empty string`); return null; }
  if (value.length > LIMITS.commandChars) { errors.push(`${where}: longer than ${LIMITS.commandChars} characters`); return null; }
  const shell = shellSyntaxIn(value);
  if (shell) {
    errors.push(`${where}: contains ${shell}; commands are plain argument strings spawned without a shell. Put pipelines in a script and call that (audit rule unix-scripts explains why).`);
    return null;
  }
  return value.trim();
}

function checkRuntimes(list, where, errors) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) { errors.push(`${where}: must be an array`); return []; }
  const out = [];
  list.slice(0, LIMITS.items).forEach((r, i) => {
    const at = `${where}[${i}]`;
    if (!plain(r)) { errors.push(`${at}: must be an object`); return; }
    unknownKeys(r, ['name', 'version', 'detect'], at, errors);
    const rt = {};
    if (typeof r.name !== 'string' || !RE_IDENT.test(r.name)) errors.push(`${at}.name: must be a lower-case identifier such as "node" or "python"`); else rt.name = r.name;
    if (typeof r.version !== 'string' || !RE_EXACT_VERSION.test(r.version)) errors.push(`${at}.version: must be an exact version such as "24.16.0" (ranges like "^24" or ">=20" are not allowed in v1)`); else rt.version = r.version;
    if (r.detect !== undefined) { const d = checkCommand(r.detect, `${at}.detect`, errors); if (d) rt.detect = d; }
    for (const k of Object.keys(r)) if (k.startsWith('x-')) rt[k] = r[k];
    if (rt.name && rt.version) out.push(rt);
  });
  return out;
}

function checkPackageManager(pm, errors) {
  if (pm === undefined || pm === null) return null;
  if (!plain(pm)) { errors.push('packageManager: must be an object { name, version }'); return null; }
  unknownKeys(pm, ['name', 'version'], 'packageManager', errors);
  if (typeof pm.name !== 'string' || !RE_IDENT.test(pm.name)) { errors.push('packageManager.name: must be a lower-case identifier such as "pnpm"'); return null; }
  if (typeof pm.version !== 'string' || !RE_EXACT_VERSION.test(pm.version)) { errors.push('packageManager.version: must be an exact version such as "10.22.0"'); return null; }
  const out = { name: pm.name, version: pm.version };
  for (const k of Object.keys(pm)) if (k.startsWith('x-')) out[k] = pm[k];
  return out;
}

function checkServices(list, errors) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) { errors.push('services: must be an array'); return []; }
  const out = [];
  list.slice(0, LIMITS.items).forEach((s, i) => {
    const at = `services[${i}]`;
    if (!plain(s)) { errors.push(`${at}: must be an object`); return; }
    unknownKeys(s, ['name', 'version', 'port', 'hint'], at, errors);
    if (typeof s.name !== 'string' || !RE_IDENT.test(s.name)) { errors.push(`${at}.name: must be a lower-case identifier such as "postgres"`); return; }
    const svc = { name: s.name };
    if (s.version !== undefined) { if (typeof s.version !== 'string' || !RE_SERVICE_VERSION.test(s.version)) errors.push(`${at}.version: must be a version string such as "16"`); else svc.version = s.version; }
    if (s.port !== undefined) { if (!Number.isInteger(s.port) || s.port < 1 || s.port > 65535) errors.push(`${at}.port: must be an integer between 1 and 65535`); else svc.port = s.port; }
    if (s.hint !== undefined) { if (!text(s.hint)) errors.push(`${at}.hint: must be a short string`); else svc.hint = s.hint; }
    for (const k of Object.keys(s)) if (k.startsWith('x-')) svc[k] = s[k];
    out.push(svc);
  });
  return out;
}

function checkEnv(list, errors) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) { errors.push('env: must be an array'); return []; }
  const out = [];
  const seen = new Set();
  list.slice(0, 256).forEach((e, i) => {
    const at = `env[${i}]`;
    if (!plain(e)) { errors.push(`${at}: must be an object`); return; }
    // Values never belong in the manifest: it is committed and shared. Say so before the generic unknown-key message.
    if ('value' in e || 'default' in e) { errors.push(`${at}: has a "${'value' in e ? 'value' : 'default'}" key; env entries hold names and descriptions only, never values`); return; }
    unknownKeys(e, ['name', 'description', 'required'], at, errors);
    if (typeof e.name !== 'string' || !RE_ENV_NAME.test(e.name)) { errors.push(`${at}.name: must be an environment variable name such as "DATABASE_URL"`); return; }
    if (seen.has(e.name)) { errors.push(`${at}.name: "${e.name}" is listed twice`); return; }
    seen.add(e.name);
    const env = { name: e.name };
    if (e.description !== undefined) { if (!text(e.description)) errors.push(`${at}.description: must be a short string`); else env.description = e.description; }
    if (e.required !== undefined) { if (typeof e.required !== 'boolean') errors.push(`${at}.required: must be true or false`); else env.required = e.required; }
    for (const k of Object.keys(e)) if (k.startsWith('x-')) env[k] = e[k];
    out.push(env);
  });
  return out;
}

function checkCommands(obj, where, errors) {
  if (obj === undefined) return {};
  if (!plain(obj)) { errors.push(`${where}: must be an object of name -> command string`); return {}; }
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('x-')) { out[k] = v; continue; }
    if (!RE_IDENT.test(k)) { errors.push(`${where}.${k}: command names are lower-case identifiers such as "install" or "db-migrate"`); continue; }
    const cmd = checkCommand(v, `${where}.${k}`, errors);
    if (cmd) out[k] = cmd;
  }
  return out;
}

function checkHealth(h, errors) {
  if (h === undefined || h === null) return null;
  if (!plain(h)) { errors.push('healthCheck: must be an object'); return null; }
  const timeout = h.timeoutSeconds === undefined ? 60 : h.timeoutSeconds;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 3600) errors.push('healthCheck.timeoutSeconds: must be an integer between 1 and 3600');
  if (h.type === 'http') {
    unknownKeys(h, ['type', 'url', 'expectStatus', 'timeoutSeconds'], 'healthCheck', errors);
    let url = null;
    try { const u = new URL(h.url); if (u.protocol === 'http:' || u.protocol === 'https:') url = h.url; } catch { /* reported below */ }
    if (!url) errors.push('healthCheck.url: must be an http or https URL');
    const status = h.expectStatus === undefined ? 200 : h.expectStatus;
    if (!Number.isInteger(status) || status < 100 || status > 599) errors.push('healthCheck.expectStatus: must be an HTTP status code');
    return { type: 'http', url, expectStatus: status, timeoutSeconds: timeout };
  }
  if (h.type === 'command') {
    unknownKeys(h, ['type', 'command', 'timeoutSeconds'], 'healthCheck', errors);
    return { type: 'command', command: checkCommand(h.command, 'healthCheck.command', errors), timeoutSeconds: timeout };
  }
  errors.push('healthCheck.type: must be "http" or "command"');
  return null;
}

function checkOs(os, errors) {
  if (os === undefined) return {};
  if (!plain(os)) { errors.push('os: must be an object keyed by windows, macos or linux'); return {}; }
  const out = {};
  for (const [name, block] of Object.entries(os)) {
    if (!OS_NAMES.includes(name)) { errors.push(`os.${name}: only ${OS_NAMES.join(', ')} can be overridden`); continue; }
    if (!plain(block)) { errors.push(`os.${name}: must be an object`); continue; }
    // Per-OS blocks override commands and runtimes only, on purpose: everything else must be the same on every machine.
    for (const k of Object.keys(block)) if (k !== 'commands' && k !== 'runtimes' && !k.startsWith('x-')) errors.push(`os.${name}.${k}: only "commands" and "runtimes" may be overridden per OS`);
    const o = {};
    if (block.commands !== undefined) o.commands = checkCommands(block.commands, `os.${name}.commands`, errors);
    if (block.runtimes !== undefined) o.runtimes = checkRuntimes(block.runtimes, `os.${name}.runtimes`, errors);
    out[name] = o;
  }
  return out;
}

/** Validate a parsed synchrobuilder.json. Returns { ok, errors, manifest } where manifest is normalized (defaults filled) when ok. */
export function validateManifest(obj) {
  const errors = [];
  if (!plain(obj)) return { ok: false, errors: ['manifest: must be a JSON object'], manifest: null };
  if (!Number.isInteger(obj.version) || obj.version < 1) errors.push('version: must be the integer 1');
  else if (obj.version > MANIFEST_VERSION) errors.push(`version: ${obj.version} is newer than this tool understands (${MANIFEST_VERSION}); update the tool`);
  unknownKeys(obj, TOP_KEYS, 'manifest', errors);
  const manifest = { version: MANIFEST_VERSION };
  if (obj.$schema !== undefined) { if (!text(obj.$schema, 300)) errors.push('$schema: must be a URL string'); else manifest.$schema = obj.$schema; }
  if (obj.name !== undefined) { if (!text(obj.name, LIMITS.name) || !obj.name.trim()) errors.push(`name: must be a string of at most ${LIMITS.name} characters`); else manifest.name = obj.name; }
  manifest.runtimes = checkRuntimes(obj.runtimes, 'runtimes', errors);
  manifest.packageManager = checkPackageManager(obj.packageManager, errors);
  manifest.services = checkServices(obj.services, errors);
  manifest.env = checkEnv(obj.env, errors);
  manifest.commands = checkCommands(obj.commands, 'commands', errors);
  manifest.healthCheck = checkHealth(obj.healthCheck, errors);
  manifest.os = checkOs(obj.os, errors);
  for (const k of Object.keys(obj)) if (k.startsWith('x-')) manifest[k] = obj[k];
  return { ok: errors.length === 0, errors, manifest: errors.length === 0 ? manifest : null };
}

/** The commands and runtimes that apply on one OS: the base values with that OS's overrides on top. */
export function forOs(manifest, osName = currentOs()) {
  const o = (manifest.os && manifest.os[osName]) || {};
  const runtimes = o.runtimes ? [...o.runtimes] : [...(manifest.runtimes || [])];
  if (o.runtimes) for (const r of manifest.runtimes || []) if (!runtimes.some((x) => x.name === r.name)) runtimes.push(r);
  return { commands: { ...(manifest.commands || {}), ...(o.commands || {}) }, runtimes };
}
