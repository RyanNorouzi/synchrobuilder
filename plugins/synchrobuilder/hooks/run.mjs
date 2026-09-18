// Synchrobuilder hook dispatcher. One process per hook event, exec form, no shell.
// Contract (ADR-003): read stdin JSON, dispatch on the verb, print at most one JSON object,
// exit 0 always. Any internal error or overrun means no output and a local log line.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logLine } from '../lib/core/log.mjs';

const VERBS = {
  'session-start': { module: 'session-start.mjs', budgetMs: 400 },
  'prompt': { module: 'prompt.mjs', budgetMs: 120 },
  'pre-edit': { module: 'pre-edit.mjs', budgetMs: 120 },
  'post-edit': { module: 'post-edit.mjs', budgetMs: 1500 },
  'stop': { module: 'stop.mjs', budgetMs: 2000 },
  'session-end': { module: 'session-end.mjs', budgetMs: 1000 },
};

const verb = process.argv[2] || '';
const spec = VERBS[verb];
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let finished = false;

function finish(output) {
  if (finished) return;
  finished = true;
  try {
    if (output && typeof output === 'object') process.stdout.write(JSON.stringify(output));
  } catch (err) {
    logLine('hooks', `${verb}: could not write output: ${err && err.message}`);
  }
  process.exitCode = 0;
}

function readStdin(limitBytes = 4 * 1024 * 1024) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(Buffer.concat(chunks).toString('utf8')); } };
    try {
      process.stdin.on('data', (c) => { size += c.length; if (size <= limitBytes) chunks.push(c); });
      process.stdin.on('end', done);
      process.stdin.on('error', done);
      process.stdin.on('close', done);
      if (process.stdin.isTTY) done();
    } catch { done(); }
    setTimeout(done, 200).unref();
  });
}

async function main() {
  if (!spec) { logLine('hooks', `unknown verb "${verb}"`); return finish(null); }
  const started = Date.now();
  const watchdog = setTimeout(() => {
    logLine('hooks', `${verb}: watchdog fired after ${spec.budgetMs} ms; exiting without output`);
    finish(null);
    process.exit(0);
  }, spec.budgetMs);
  watchdog.unref();
  const raw = await readStdin();
  let input = {};
  try { input = raw.trim() ? JSON.parse(raw) : {}; } catch (err) { logLine('hooks', `${verb}: stdin was not JSON (${err.message}); continuing with empty input`); }
  const ctx = { verb, pluginRoot, startedAt: started, env: process.env };
  let output = null;
  try {
    const mod = await import(`../lib/hooks/${spec.module}`);
    output = await mod.run(input, ctx);
  } catch (err) {
    logLine('hooks', `${verb}: ${err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err}`);
    output = null;
  }
  clearTimeout(watchdog);
  finish(output);
  const elapsed = Date.now() - started;
  if (elapsed > spec.budgetMs / 2) logLine('hooks', `${verb}: slow (${elapsed} ms of ${spec.budgetMs} ms budget)`);
}

main().catch((err) => { logLine('hooks', `${verb}: fatal ${err && err.message}`); finish(null); });
