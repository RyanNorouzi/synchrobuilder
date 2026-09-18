// setup [--plan] [--yes] [--json]: compare synchrobuilder.json with this machine, show the plan for this OS,
// ask before every step that runs something, stop on the first failure, then run the health check (docs/commands.md).
// Never elevates, never uses a shell; steps that need sudo or a shell function are printed for the user to run.
import readline from 'node:readline';
import { logLine } from '../core/log.mjs';
import path from 'node:path';
import { loadManifestModules } from '../setup/bridge.mjs';
import { detectFingerprint, detectComposeFile } from '../setup/detect.mjs';
import { buildPlan } from '../setup/plan.mjs';
import { runStep, spawnStep } from '../setup/exec.mjs';
import { runHealthCheck } from '../setup/health.mjs';
import { formatPlan, formatResult, formatHealth } from '../setup/format.mjs';

const OUTPUT_LINES_ON_SUCCESS = 20;
const START_GRACE_MS = 1500;

/** Prefer the doctor's fingerprint when that module exists; fall back to the local detector otherwise. */
async function loadFingerprint({ cwd, platform }) {
  try {
    const mod = await import('../doctor/fingerprint.mjs');
    const fn = mod.buildFingerprint || mod.collectFingerprint || mod.fingerprint || mod.default;
    if (typeof fn === 'function') {
      const fp = await fn({ cwd, platform });
      if (fp && typeof fp === 'object') return fp;
    }
  } catch (err) {
    if (!(err && err.code === 'ERR_MODULE_NOT_FOUND')) logLine('setup', `doctor fingerprint failed, using local detector: ${err && err.message}`);
  }
  return detectFingerprint({ platform });
}

/** Yes/no on stdin. A non-terminal stdin answers "no" so CI never hangs; --yes is the only unattended "yes". */
function ask(question, { stdin, stderr }) {
  if (!stdin || !stdin.isTTY) {
    stderr.write(`${question} [y/N] -> no (stdin is not a terminal; pass --yes to run steps unattended)\n`);
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: stdin, output: stderr, terminal: false });
    rl.question(`${question} [y/N] `, (answer) => { rl.close(); resolve(/^y(es)?$/i.test(String(answer).trim())); });
  });
}

function tail(text, max) {
  const lines = String(text || '').split('\n');
  return lines.length > max ? [`... (${lines.length - max} earlier lines omitted)`, ...lines.slice(-max)] : lines;
}

function say(stdout, json, text) { if (!json) stdout.write(text + '\n'); }

/** Execute the plan in order. Returns { results, failed, background }. */
async function executeSteps(steps, ctx) {
  const { cwd, platform, yes, json, stdout, stderr, stdin } = ctx;
  const results = [];
  let background = null;
  let failed = false;
  for (const step of steps) {
    if (step.kind === 'health') continue;
    const record = (status, extra = {}) => { results.push({ id: step.id, status, ...extra }); say(stdout, json, formatResult(step, { status, ...extra })); };
    if (step.alreadySatisfied) { record('satisfied'); continue; }
    if (!step.command) { record('manual', { manual: step.manual }); say(stdout, json, `  you run: ${step.manual}`); continue; }
    say(stdout, json, `\n-> ${step.title}\n   ${step.why}`);
    if (step.needsConsent && !yes && !(await ask('Run this step?', { stdin, stderr }))) { record('declined'); continue; }
    if (step.background) {
      const handle = spawnStep(step, { cwd, platform, onOutput: (t) => say(stdout, json, `   | ${t.split('\n').join('\n   | ')}`) });
      if (handle.manual) { record('manual', { manual: step.manual }); say(stdout, json, `  you run: ${step.manual}`); continue; }
      background = handle;
      record('started', { pid: handle.pid });
      await new Promise((resolve) => setTimeout(resolve, START_GRACE_MS));
      if (handle.state.code !== null || handle.state.error) { record('failed', { code: handle.state.code, output: handle.state.error }); failed = true; break; }
      continue;
    }
    const r = runStep(step, { cwd, platform });
    if (r.manual) { record('manual', { manual: step.manual }); say(stdout, json, `  you run: ${step.manual}`); continue; }
    if (!r.ok) {
      record('failed', { code: r.code, output: r.output });
      say(stdout, json, r.output ? `   | ${r.output.split('\n').join('\n   | ')}` : '   (no output)');
      say(stdout, json, 'Setup stopped at this step. Fix the problem and run "synchrobuilder setup" again.');
      failed = true;
      break;
    }
    record('ran', { code: r.code });
    for (const line of tail(r.output, OUTPUT_LINES_ON_SUCCESS)) if (line) say(stdout, json, `   | ${line}`);
  }
  return { results, failed, background };
}

export async function run({ args = [], flags = {}, cwd = process.cwd(), stdout = process.stdout, stderr = process.stderr, stdin = process.stdin, platform = process.platform, fingerprint = null }) {
  const json = Boolean(flags.json);
  const root = args[0] ? path.resolve(cwd, args[0]) : cwd;
  const modules = await loadManifestModules();
  const read = modules.readManifest(root);
  // readManifest returns { ok, exists, errors, manifest } from lib/manifest/io.mjs; the test stub returns the object itself.
  const envelope = read && typeof read === 'object' && ('manifest' in read || 'exists' in read) ? read : null;
  const raw = envelope ? envelope.manifest : read;
  if (envelope && !envelope.exists) { stderr.write(`No synchrobuilder.json found in ${root}. Run "synchrobuilder init" first to create one.\n`); return 2; }
  if (!raw) { stderr.write(`No synchrobuilder.json found in ${root}. Run "synchrobuilder init" first to create one.\n`); return 2; }
  const v = envelope ? { ok: envelope.ok, errors: envelope.errors, manifest: envelope.manifest } : modules.validateManifest(raw);
  if (!v || !v.ok) { stderr.write(`synchrobuilder.json is not valid:\n${((v && v.errors) || ['unknown error']).map((e) => `  - ${e}`).join('\n')}\n`); return 1; }
  const manifest = v.manifest || raw;
  const fp = fingerprint || await loadFingerprint({ cwd: root, platform });
  // Only the NAMES of manifest env vars are checked against the environment; values are never read or stored.
  const wanted = new Set((Array.isArray(manifest.env) ? manifest.env : []).map((e) => e && e.name).filter(Boolean));
  const envPresent = Object.keys(process.env).filter((k) => wanted.has(k));
  const steps = buildPlan({ manifest, fingerprint: fp, platform, composeFile: detectComposeFile(root), envPresent, tokenize: modules.tokenizeCommand });

  say(stdout, json, formatPlan(steps, { platform, manifestName: manifest.name }));
  if (flags.plan) {
    if (json) stdout.write(JSON.stringify({ platform, manifest: manifest.name || null, manifestSource: modules.source, plan: steps }, null, 2) + '\n');
    return 0;
  }

  const { results, failed, background } = await executeSteps(steps, { cwd: root, platform, yes: Boolean(flags.yes), json, stdout, stderr, stdin });
  let health;
  if (failed) health = { ok: false, evidence: [`setup stopped at "${results[results.length - 1].id}" before the health check could run`] };
  else if (manifest.healthCheck) {
    say(stdout, json, '\nRunning the health check...');
    health = await runHealthCheck(manifest.healthCheck, { cwd: root, platform, tokenize: modules.tokenizeCommand });
  } else health = { ok: !failed, evidence: ['no healthCheck in the manifest; nothing verified beyond the steps above'] };
  if (background) { background.stop(); say(stdout, json, `Stopped the background start command (pid ${background.pid}); start it yourself when you are ready.`); }
  say(stdout, json, '\n' + formatHealth(health));
  if (json) stdout.write(JSON.stringify({ platform, manifest: manifest.name || null, manifestSource: modules.source, plan: steps, results, health }, null, 2) + '\n');
  return failed || !health.ok ? 1 : 0;
}
