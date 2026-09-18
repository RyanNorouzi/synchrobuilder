// Turn a manifest plus a machine fingerprint into an ordered list of setup steps for one OS (PLAN Phase 4, ADR-004).
// A step either has an argv `command` the runner can spawn without a shell, or a `manual` string the user runs
// themselves. Nothing here touches the machine: it is pure data in, pure data out, so the plan can be shown first.
//
// Fingerprint shape (lib/doctor/fingerprint.mjs, or lib/setup/detect.mjs until it lands):
//   { tools: { node: { version: '24.16.0' } | '24.16.0' | null, pnpm: ..., fnm: ..., docker: ..., winget: ... },
//     services: { postgres: { reachable: true } }, envPresent: ['DATABASE_URL'] }
// Only tool names, versions and env var NAMES are ever read; env values are never looked at.
import { osKey, versionManagerRecipe, nativeRuntimeRecipe, serviceRecipe } from './installers.mjs';

const VERSION_MANAGERS = ['volta', 'fnm', 'nvm'];
const COMMAND_ORDER = ['install', 'migrate', 'seed', 'start'];
const COMPOSE_FILES = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];

export { COMPOSE_FILES };

export function normalizeVersion(v) {
  if (v === null || v === undefined) return null;
  const s = String(typeof v === 'object' ? v.version ?? '' : v).trim().replace(/^v/i, '');
  return s || null;
}

/** Version string of a detected tool, or null when it is absent. Accepts several fingerprint spellings. */
export function toolVersion(fingerprint, name) {
  const tools = (fingerprint && fingerprint.tools) || {};
  const entry = tools[name];
  if (entry === undefined || entry === null || entry === false) return null;
  if (typeof entry === 'string') return normalizeVersion(entry);
  if (typeof entry === 'object') return entry.found === false ? null : normalizeVersion(entry.version) || 'unknown';
  return entry === true ? 'unknown' : null;
}

export function toolPresent(fingerprint, name) { return toolVersion(fingerprint, name) !== null; }

/** Apply the manifest's `os.<key>` overrides (commands and runtimes only, per ADR-004). */
export function resolveForOs(manifest, platform) {
  const override = (manifest.os && manifest.os[osKey(platform)]) || {};
  const commands = { ...(manifest.commands || {}), ...(override.commands || {}) };
  const base = Array.isArray(manifest.runtimes) ? manifest.runtimes : [];
  const extra = Array.isArray(override.runtimes) ? override.runtimes : [];
  const runtimes = base.map((r) => extra.find((o) => o && o.name === r.name) || r).concat(extra.filter((o) => o && !base.some((r) => r.name === o.name)));
  return { commands, runtimes };
}

function tokenizeSafe(tokenize, str) {
  try {
    const argv = tokenize(str);
    return Array.isArray(argv) && argv.length ? { argv } : { error: 'empty command' };
  } catch (err) { return { error: err && err.message ? err.message : String(err) }; }
}

function runtimeStep(rt, fingerprint, platform) {
  const want = normalizeVersion(rt.version);
  const have = toolVersion(fingerprint, rt.name);
  const managers = VERSION_MANAGERS.filter((m) => toolPresent(fingerprint, m));
  const tools = ['winget', 'brew'].filter((t) => toolPresent(fingerprint, t));
  const recipe = versionManagerRecipe(rt.name, want, managers, platform) || nativeRuntimeRecipe(rt.name, want, platform, tools);
  const why = have ? `manifest pins ${rt.name} ${want}; this machine has ${have}` : `manifest pins ${rt.name} ${want}; ${rt.name} was not found on PATH`;
  return {
    id: `runtime:${rt.name}`, kind: 'runtime', title: `Install ${rt.name} ${want}${recipe.tool ? ` with ${recipe.tool}` : ''}`,
    why: recipe.note ? `${why}. ${recipe.note}` : why,
    command: recipe.command || null, manual: recipe.manual || null,
    needsConsent: Boolean(recipe.command), alreadySatisfied: have !== null && have === want,
  };
}

function packageManagerStep(pm, fingerprint) {
  const want = normalizeVersion(pm.version);
  const have = toolVersion(fingerprint, pm.name);
  const satisfied = have !== null && (want === null || have === want);
  // Corepack ships with Node and knows how to pin pnpm/yarn; npm updates itself. exec.mjs turns these into node + JS entry points on Windows.
  const command = pm.name === 'npm' ? ['npm', 'install', '-g', want ? `npm@${want}` : 'npm'] : ['corepack', 'prepare', want ? `${pm.name}@${want}` : pm.name, '--activate'];
  return {
    id: `packageManager:${pm.name}`, kind: 'packageManager', title: `Activate ${pm.name}${want ? ' ' + want : ''}`,
    why: have ? `manifest pins ${pm.name} ${want || ''}; this machine has ${have}`.trim() : `manifest pins ${pm.name}${want ? ' ' + want : ''}; it was not found on PATH`,
    command, manual: null, needsConsent: true, alreadySatisfied: satisfied,
  };
}

function serviceSteps(services, fingerprint, platform, composeFile) {
  const steps = [];
  const useCompose = composeFile && toolPresent(fingerprint, 'docker');
  if (useCompose && services.length) {
    steps.push({
      id: 'service:compose', kind: 'service', title: 'Start services with Docker Compose',
      why: `docker is on PATH and ${composeFile} exists, so the services below can run in containers`,
      command: ['docker', 'compose', '-f', composeFile, 'up', '-d'], manual: null, needsConsent: true, alreadySatisfied: false,
    });
  }
  for (const svc of services) {
    if (!svc || typeof svc.name !== 'string') continue;
    const reachable = Boolean(fingerprint && fingerprint.services && fingerprint.services[svc.name] && fingerprint.services[svc.name].reachable);
    const hint = typeof svc.hint === 'string' && svc.hint ? ` ${svc.hint}.` : '';
    const port = svc.port ? ` on port ${svc.port}` : '';
    steps.push({
      id: `service:${svc.name}`, kind: 'service', title: `Provide ${svc.name}${svc.version ? ' ' + svc.version : ''}${port}`,
      why: `the project needs ${svc.name}${port}.${hint}${useCompose ? ' Docker Compose covers this if the compose file defines it; otherwise install it natively:' : ' Install it natively (Synchrobuilder never installs services for you):'}`,
      command: null, manual: serviceRecipe(svc, platform), needsConsent: false, alreadySatisfied: reachable,
    });
  }
  return steps;
}

function envSteps(env, envPresent) {
  const present = new Set(Array.isArray(envPresent) ? envPresent : []);
  return env.filter((e) => e && typeof e.name === 'string').map((e) => ({
    id: `env:${e.name}`, kind: 'env', title: `Set ${e.name}${e.required === false ? ' (optional)' : ''}`,
    why: `${e.description || 'required by the project'}. Synchrobuilder only knows the name; it never reads or stores the value`,
    command: null, manual: `Set ${e.name} in your shell profile or a local .env file (never commit it)`,
    needsConsent: false, alreadySatisfied: present.has(e.name),
  }));
}

function commandSteps(commands, tokenize) {
  const steps = [];
  for (const kind of COMMAND_ORDER) {
    const raw = commands[kind];
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const t = tokenizeSafe(tokenize, raw);
    steps.push({
      id: `command:${kind}`, kind, title: `${kind[0].toUpperCase()}${kind.slice(1)}: ${raw}`,
      why: t.argv ? `manifest commands.${kind}` : `manifest commands.${kind} could not be split into arguments: ${t.error}`,
      command: t.argv || null, manual: t.argv ? null : `${raw}  (run it yourself; fix the manifest so it has no shell syntax)`,
      needsConsent: Boolean(t.argv), alreadySatisfied: false, background: kind === 'start',
    });
  }
  return steps;
}

/**
 * buildPlan({ manifest, fingerprint, platform, composeFile, envPresent, tokenize }) -> ordered steps.
 * `tokenize` is the manifest tokenizer (lib/manifest/schema.mjs tokenizeCommand); the caller injects it so this
 * module has no import that might not exist yet.
 */
export function buildPlan({ manifest, fingerprint = {}, platform = process.platform, composeFile = null, envPresent = [], tokenize }) {
  if (!manifest || typeof manifest !== 'object') return [];
  const tok = typeof tokenize === 'function' ? tokenize : (s) => String(s).trim().split(/\s+/);
  const { commands, runtimes } = resolveForOs(manifest, platform);
  const steps = [];
  for (const rt of runtimes) if (rt && typeof rt.name === 'string' && rt.version !== undefined) steps.push(runtimeStep(rt, fingerprint, platform));
  if (manifest.packageManager && typeof manifest.packageManager.name === 'string') steps.push(packageManagerStep(manifest.packageManager, fingerprint));
  steps.push(...serviceSteps(Array.isArray(manifest.services) ? manifest.services : [], fingerprint, platform, composeFile));
  steps.push(...envSteps(Array.isArray(manifest.env) ? manifest.env : [], envPresent));
  steps.push(...commandSteps(commands, tok));
  if (manifest.healthCheck && typeof manifest.healthCheck === 'object') {
    const hc = manifest.healthCheck;
    steps.push({
      id: 'health', kind: 'health', title: hc.type === 'http' ? `Health check: GET ${hc.url}` : `Health check: ${hc.command || '(command)'}`,
      why: `manifest healthCheck (${hc.type}), up to ${hc.timeoutSeconds || 30}s`, command: null, manual: null,
      needsConsent: false, alreadySatisfied: false, healthCheck: hc,
    });
  }
  return steps;
}
