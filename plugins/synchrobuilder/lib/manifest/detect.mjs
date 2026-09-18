// detectProject(root): everything init can work out about a project by reading files, plus a few version probes.
// Every guess is listed in `unsure` with the field it touched, so init can show the user exactly what to confirm.
// Values of environment variables are never read (detect-env.mjs opens example files only, and discards values).
import fs from 'node:fs';
import path from 'node:path';
import { readJson, readText, exists } from '../core/fsx.mjs';
import { detectComposeServices, detectMakeTargets } from './detect-services.mjs';
import { detectEnv, servicesFromEnvNames } from './detect-env.mjs';
import { toolVersion } from './tools.mjs';
import { validateManifest, MANIFEST_VERSION, SCHEMA_URL } from './schema.mjs';

const RE_EXACT = /^v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.]+)?)$/;
const RE_MAJOR_MINOR = /^v?(\d+\.\d+)$/;
const LOCKFILES = [
  ['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['bun.lock', 'bun'], ['bun.lockb', 'bun'], ['package-lock.json', 'npm'], ['npm-shrinkwrap.json', 'npm'],
];
const PYTHON_FILES = ['requirements.txt', 'pyproject.toml', 'Pipfile', 'setup.py', 'setup.cfg'];

function exact(text) {
  const s = String(text || '').trim();
  const m = s.match(RE_EXACT) || s.match(RE_MAJOR_MINOR);
  return m ? m[1] : null;
}

function readPackageJson(root) {
  const pkg = readJson(path.join(root, 'package.json'), null);
  return pkg && typeof pkg === 'object' && !Array.isArray(pkg) ? pkg : null;
}

/** Node: a pin file wins, then an exact engines.node, then the node running init (marked unsure). */
export function detectNode(root, pkg, { nodeVersion = process.version } = {}) {
  const unsure = [];
  for (const file of ['.nvmrc', '.node-version']) {
    const text = readText(path.join(root, file), null);
    if (text === null) continue;
    const v = exact(text);
    if (v) return { runtime: { name: 'node', version: v, detect: 'node --version' }, source: file, unsure };
    unsure.push({ field: 'runtimes.node.version', reason: `${file} says "${text.trim().slice(0, 20)}", which is not an exact version` });
  }
  const engines = pkg && pkg.engines && typeof pkg.engines.node === 'string' ? pkg.engines.node : null;
  if (engines) {
    const v = exact(engines);
    if (v) return { runtime: { name: 'node', version: v, detect: 'node --version' }, source: 'package.json engines', unsure };
    unsure.push({ field: 'runtimes.node.version', reason: `package.json engines.node is the range "${engines}"; the manifest needs one exact version` });
  }
  if (!pkg && !unsure.length) return { runtime: null, source: null, unsure };
  const current = exact(nodeVersion);
  if (!current) return { runtime: null, source: null, unsure };
  unsure.push({ field: 'runtimes.node.version', reason: `no exact pin found; recorded the node that ran init (${current}). Add a .nvmrc to pin it` });
  return { runtime: { name: 'node', version: current, detect: 'node --version' }, source: 'current node', unsure };
}

/** Python: only when a Python project file exists. Version from .python-version or runtime.txt, else the interpreter on this machine. */
export function detectPython(root, { probe } = {}) {
  const unsure = [];
  if (!PYTHON_FILES.some((f) => exists(path.join(root, f)))) return { runtime: null, source: null, unsure };
  const pin = readText(path.join(root, '.python-version'), null);
  const pinned = pin === null ? null : exact(pin.split(/\r?\n/)[0]);
  if (pinned) return { runtime: { name: 'python', version: pinned, detect: 'python --version' }, source: '.python-version', unsure };
  const rt = readText(path.join(root, 'runtime.txt'), null);
  const fromRuntime = rt === null ? null : exact(rt.trim().replace(/^python-/i, ''));
  if (fromRuntime) return { runtime: { name: 'python', version: fromRuntime, detect: 'python --version' }, source: 'runtime.txt', unsure };
  for (const name of ['python3', 'python']) {
    const t = toolVersion(name, probe ? { probe } : {});
    if (t.version) {
      unsure.push({ field: 'runtimes.python.version', reason: `no .python-version found; recorded the ${name} on this machine (${t.version})` });
      return { runtime: { name: 'python', version: t.version, detect: 'python --version' }, source: `current ${name}`, unsure };
    }
  }
  unsure.push({ field: 'runtimes.python', reason: 'the project uses Python but no version could be found; add a .python-version file and run init --refresh' });
  return { runtime: null, source: null, unsure };
}

/** Package manager: the package.json "packageManager" field, else the lockfile, with the version from this machine when unpinned. */
export function detectPackageManager(root, pkg, { probe } = {}) {
  const unsure = [];
  if (pkg && typeof pkg.packageManager === 'string') {
    const m = pkg.packageManager.match(/^([a-z][a-z0-9-]*)@(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.]+)?)/);
    if (m) return { packageManager: { name: m[1], version: m[2].replace(/\+.*$/, '') }, source: 'package.json packageManager', unsure };
    unsure.push({ field: 'packageManager', reason: `package.json packageManager is "${pkg.packageManager.slice(0, 40)}", expected "<name>@<exact version>"` });
  }
  const found = LOCKFILES.filter(([file]) => exists(path.join(root, file))).map(([, name]) => name);
  const names = [...new Set(found)];
  if (!names.length && !pkg) return { packageManager: null, source: null, unsure };
  const name = names[0] || 'npm';
  if (names.length > 1) unsure.push({ field: 'packageManager.name', reason: `several lockfiles found (${names.join(', ')}); chose ${name}` });
  if (!names.length) unsure.push({ field: 'packageManager.name', reason: 'no lockfile found; assumed npm' });
  const t = toolVersion(name, probe ? { probe } : {});
  if (!t.version) {
    unsure.push({ field: 'packageManager.version', reason: `${name} is not installed here, so no exact version could be recorded; add "packageManager": "${name}@<version>" to package.json` });
    return { packageManager: null, source: names.length ? 'lockfile' : 'default', unsure };
  }
  unsure.push({ field: 'packageManager.version', reason: `recorded the ${name} on this machine (${t.version}); pin it with "packageManager" in package.json` });
  return { packageManager: { name, version: t.version }, source: names.length ? 'lockfile' : 'default', unsure };
}

const INSTALL = { npm: 'npm ci', pnpm: 'pnpm install --frozen-lockfile', yarn: 'yarn install --frozen-lockfile', bun: 'bun install --frozen-lockfile' };
const SCRIPT_FOR = { build: ['build'], test: ['test'], start: ['dev', 'start'], migrate: ['migrate', 'db:migrate', 'prisma:migrate'], seed: ['seed', 'db:seed'] };

/** Manifest commands from package.json scripts (via the package manager), Makefile targets, then Python defaults. */
export function detectCommands(root, pkg, pm, { python = false } = {}) {
  const commands = {};
  const unsure = [];
  const scripts = pkg && pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
  const pmName = pm ? pm.name : (pkg ? 'npm' : null);
  if (pkg && pmName) commands.install = INSTALL[pmName] || `${pmName} install`;
  for (const [cmd, candidates] of Object.entries(SCRIPT_FOR)) {
    const script = candidates.find((s) => typeof scripts[s] === 'string' && scripts[s].trim());
    if (script && pmName) commands[cmd] = cmd === 'test' && script === 'test' && pmName !== 'bun' ? `${pmName} test` : `${pmName} run ${script}`;
  }
  const make = detectMakeTargets(root);
  for (const target of make.targets) {
    const cmd = target === 'dev' ? 'start' : target;
    if (!commands[cmd]) commands[cmd] = `make ${target}`;
  }
  if (make.targets.length) unsure.push({ field: 'commands', reason: 'some commands call make, which is not installed by default on Windows' });
  if (python && !commands.install && exists(path.join(root, 'requirements.txt'))) {
    commands.install = 'python -m pip install -r requirements.txt';
    unsure.push({ field: 'commands.install', reason: 'assumed pip with requirements.txt' });
  }
  if (python && !commands.test) {
    const req = readText(path.join(root, 'requirements.txt'), '') + readText(path.join(root, 'pyproject.toml'), '');
    if (/pytest/i.test(req)) { commands.test = 'python -m pytest'; unsure.push({ field: 'commands.test', reason: 'assumed pytest because it is listed as a dependency' }); }
  }
  return { commands, unsure };
}

/** A port mentioned in the start script ("--port 8080", "PORT=8080", ":8080"), else 3000. */
export function guessPort(pkg) {
  const scripts = pkg && pkg.scripts ? Object.values(pkg.scripts).filter((s) => typeof s === 'string').join(' ') : '';
  const m = scripts.match(/(?:--port[= ]|PORT=|localhost:)(\d{2,5})\b/);
  const port = m ? Number(m[1]) : 3000;
  return port > 0 && port < 65536 ? port : 3000;
}

export function detectProject(root, { probe, nodeVersion = process.version } = {}) {
  const pkg = readPackageJson(root);
  const unsure = [];
  const sources = {};
  const runtimes = [];
  const node = detectNode(root, pkg, { nodeVersion });
  if (node.runtime) { runtimes.push(node.runtime); sources.node = node.source; }
  unsure.push(...node.unsure);
  const py = detectPython(root, { probe });
  if (py.runtime) { runtimes.push(py.runtime); sources.python = py.source; }
  unsure.push(...py.unsure);
  const pm = detectPackageManager(root, pkg, { probe });
  if (pm.source) sources.packageManager = pm.source;
  unsure.push(...pm.unsure);
  const env = detectEnv(root);
  if (env.file) sources.env = env.file;
  unsure.push(...env.unsure);
  const compose = detectComposeServices(root);
  const services = [...compose.services];
  unsure.push(...compose.unsure);
  for (const s of servicesFromEnvNames(env.entries.map((e) => e.name))) {
    if (services.some((x) => x.name === s.name)) continue;
    services.push(s);
    unsure.push({ field: `services.${s.name}`, reason: `${s.hint.toLowerCase()}; confirm the service and add its version, or remove it` });
  }
  const cmds = detectCommands(root, pkg, pm.packageManager, { python: !!py.runtime });
  unsure.push(...cmds.unsure);
  let healthCheck = null;
  if (cmds.commands.start) {
    const port = guessPort(pkg);
    healthCheck = { type: 'http', url: `http://localhost:${port}/`, expectStatus: 200, timeoutSeconds: 60 };
    unsure.push({ field: 'healthCheck.url', reason: `guessed port ${port} from the start script; point this at a real health endpoint` });
  }
  const name = pkg && typeof pkg.name === 'string' && pkg.name.trim() ? pkg.name.trim().slice(0, 100) : path.basename(path.resolve(root));
  const manifest = { $schema: SCHEMA_URL, version: MANIFEST_VERSION, name, runtimes, packageManager: pm.packageManager, services, env: env.entries, commands: cmds.commands, healthCheck };
  const v = validateManifest(manifest);
  return { manifest: v.ok ? v.manifest : manifest, errors: v.errors, unsure, sources, hasProjectFiles: !!pkg || !!py.runtime || fs.existsSync(path.join(root, 'Makefile')) };
}
