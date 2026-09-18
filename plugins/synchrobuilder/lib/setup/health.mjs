// The manifest health check (ADR-004): GET a URL and expect a status, or spawn a program and expect exit 0.
// Polls until the manifest's timeoutSeconds so a freshly started dev server has time to come up. Returns evidence
// lines a human can read; the response body is trimmed to a short snippet and control characters are stripped.
import http from 'node:http';
import https from 'node:https';
import { resolveArgv, formatCommand } from './exec.mjs';
import { run } from '../core/proc.mjs';

const SNIPPET_CHARS = 200;
const REQUEST_TIMEOUT_MS = 5000;
const POLL_MS = 1000;
const MAX_TOTAL_MS = 10 * 60 * 1000;

export function snippet(text) {
  const s = String(text ?? '').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '').replace(/\s+/g, ' ').trim();
  return s.length > SNIPPET_CHARS ? s.slice(0, SNIPPET_CHARS - 1) + '…' : s;
}

function totalMs(healthCheck) {
  const s = Number(healthCheck && healthCheck.timeoutSeconds);
  return Math.min(MAX_TOTAL_MS, (Number.isFinite(s) && s > 0 ? s : 30) * 1000);
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

/** One GET; resolves to { status, body } or { error }. Never rejects. */
export function httpGet(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let target;
    try { target = new URL(url); } catch { resolve({ error: `invalid url: ${url}` }); return; }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') { resolve({ error: `unsupported protocol: ${target.protocol}` }); return; }
    const mod = target.protocol === 'https:' ? https : http;
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const req = mod.get(target, { timeout: timeoutMs, headers: { 'user-agent': 'synchrobuilder-setup', accept: '*/*' } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { if (body.length < 4096) body += chunk; });
      res.on('end', () => finish({ status: res.statusCode, body }));
      res.on('error', (err) => finish({ error: err.message }));
    });
    req.on('timeout', () => { req.destroy(new Error(`no response within ${timeoutMs}ms`)); });
    req.on('error', (err) => finish({ error: err.message }));
  });
}

async function checkHttp(healthCheck) {
  const expect = Number.isInteger(healthCheck.expectStatus) ? healthCheck.expectStatus : 200;
  const deadline = Date.now() + totalMs(healthCheck);
  const evidence = [];
  let attempts = 0;
  let last = null;
  while (true) {
    attempts++;
    const started = Date.now();
    last = await httpGet(healthCheck.url);
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    if (last.status !== undefined) {
      evidence.push(`GET ${healthCheck.url} -> ${last.status} (expected ${expect}, ${elapsed}s, attempt ${attempts})`);
      if (snippet(last.body)) evidence.push(`body: ${snippet(last.body)}`);
      if (last.status === expect) return { ok: true, evidence };
    }
    if (Date.now() + POLL_MS > deadline) break;
    await sleep(POLL_MS);
  }
  if (last && last.error) evidence.push(`GET ${healthCheck.url} failed: ${snippet(last.error)} (after ${attempts} attempt${attempts === 1 ? '' : 's'})`);
  evidence.push(`gave up after ${Math.round(totalMs(healthCheck) / 1000)}s`);
  return { ok: false, evidence };
}

function checkCommand(healthCheck, { cwd, platform, tokenize, execPath, exists }) {
  const evidence = [];
  let argv = healthCheck.command;
  if (typeof argv === 'string') {
    try { argv = (typeof tokenize === 'function' ? tokenize : (s) => s.trim().split(/\s+/))(argv); } catch (err) { return { ok: false, evidence: [`health command rejected: ${err.message}`] }; }
  }
  const resolved = resolveArgv(argv, platform, { execPath, exists });
  if (!resolved) return { ok: false, evidence: [`cannot spawn "${formatCommand(argv)}" without a shell on this OS; run it yourself`] };
  const r = run(resolved.program, resolved.args, { cwd, timeoutMs: totalMs(healthCheck) });
  evidence.push(`${formatCommand(argv)} -> exit code ${r.code}${r.timedOut ? ' (timed out)' : ''}`);
  const out = snippet(r.stdout || r.stderr || r.error || '');
  if (out) evidence.push(`output: ${out}`);
  return { ok: r.code === 0 && !r.timedOut, evidence };
}

/** runHealthCheck(healthCheck, { cwd, platform, tokenize }) -> { ok, evidence: string[] }. Never throws. */
export async function runHealthCheck(healthCheck, opts = {}) {
  try {
    if (!healthCheck || typeof healthCheck !== 'object') return { ok: false, evidence: ['no health check in the manifest'] };
    if (healthCheck.type === 'http') return typeof healthCheck.url === 'string' ? await checkHttp(healthCheck) : { ok: false, evidence: ['http health check has no url'] };
    if (healthCheck.type === 'command') return healthCheck.command ? checkCommand(healthCheck, opts) : { ok: false, evidence: ['command health check has no command'] };
    return { ok: false, evidence: [`unknown health check type: ${String(healthCheck.type)}`] };
  } catch (err) {
    return { ok: false, evidence: [`health check crashed: ${snippet(err && err.message)}`] };
  }
}
