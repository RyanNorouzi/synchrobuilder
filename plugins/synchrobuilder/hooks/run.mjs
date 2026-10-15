// Synchrobuilder hook dispatcher. One process per hook event, exec form, no shell.
// Contract (ADR-003): read stdin JSON, dispatch on the verb, print at most one JSON object,
// exit 0 always. Any internal error or overrun means no output and a local log line.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logLine } from '../lib/core/log.mjs';

// Budgets are a self-imposed watchdog, well inside the 5 s timeout Claude Code allows a hook. They exist so a
// slow disk or a stuck read can never make a developer wait, not to hit a latency target.
//
// prompt and pre-edit were 120 ms. That was measured against a fast machine: the same hooks cost 21 to 26 ms
// on macOS but a Windows CI runner runs them roughly four times slower, and session-start there reports 224 ms
// of its 400 ms. At 120 ms the pre-edit watchdog fired on that runner and the collision warning vanished with
// no sign to the user, which is the worst outcome available: the feature silently stops working on exactly the
// machines least able to afford a lost warning. 400 ms is still far below anything a person notices between an
// agent deciding to edit and the edit happening, and the hook still cannot hang.
const VERBS = {
  'session-start': { module: 'session-start.mjs', budgetMs: 400 },
  'prompt': { module: 'prompt.mjs', budgetMs: 400 },
  'pre-edit': { module: 'pre-edit.mjs', budgetMs: 400 },
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
