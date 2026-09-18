#!/usr/bin/env node
// `npx synchrobuilder <command>`: the same code the plugin's skills run, usable outside Claude Code and in CI.
import { parseArgs } from '../lib/core/args.mjs';
import { pluginVersion } from '../lib/core/version.mjs';

const COMMANDS = {
  audit: { module: 'audit.mjs', phase: 2, summary: 'Scan the project for OS-specific assumptions' },
  fix: { module: 'fix.mjs', phase: 3, summary: 'Propose and apply fixes for audit findings' },
  mute: { module: 'mute.mjs', phase: 3, summary: 'Silence the guard hook for this checkout' },
  init: { module: 'init.mjs', phase: 4, summary: 'Write synchrobuilder.json for this project' },
  setup: { module: 'setup.mjs', phase: 4, summary: 'Set this machine up from synchrobuilder.json' },
  doctor: { module: 'doctor.mjs', phase: 4, summary: 'Explain why this machine differs from the manifest' },
  ci: { module: 'ci.mjs', phase: 4, summary: 'Generate a three-OS GitHub Actions workflow' },
  iam: { module: 'iam.mjs', phase: 5, summary: 'Set your handle for this checkout' },
  status: { module: 'status.mjs', phase: 6, summary: 'Who is active and what the sync transport is doing' },
  claim: { module: 'claim.mjs', phase: 6, summary: 'Claim a path or task' },
  release: { module: 'release.mjs', phase: 6, summary: 'Release a claim' },
  notify: { module: 'notify.mjs', phase: 6, summary: 'Message a teammate' },
  board: { module: 'board.mjs', phase: 6, summary: 'Shared task board' },
  handoff: { module: 'handoff.mjs', phase: 6, summary: 'Write a handoff note' },
  statusline: { module: 'statusline.mjs', phase: 6, summary: 'Install or remove the status line' },
  clean: { module: 'clean.mjs', phase: 5, summary: 'Remove ~/.synchrobuilder' },
  worker: { module: 'worker.mjs', phase: 5, summary: 'Run the background sync worker (internal)' },
};

function usage() {
  const lines = ['synchrobuilder ' + pluginVersion(), '', 'Usage: synchrobuilder <command> [options]', ''];
  for (const [name, c] of Object.entries(COMMANDS)) if (name !== 'worker') lines.push(`  ${name.padEnd(12)} ${c.summary}`);
  lines.push('', 'Options: --json, --strict, --yes, --dry-run, --help, --version');
  return lines.join('\n');
}

async function main() {
  const { flags, positionals } = parseArgs(process.argv.slice(2), { booleans: ['json', 'strict', 'yes', 'dry-run', 'help', 'version', 'refresh', 'quiet'] });
  if (flags.version) { process.stdout.write(pluginVersion() + '\n'); return 0; }
  const name = positionals[0];
  if (!name || flags.help && !name) { process.stdout.write(usage() + '\n'); return name ? 0 : 1; }
  const spec = COMMANDS[name];
  if (!spec) { process.stderr.write(`Unknown command "${name}".\n\n${usage()}\n`); return 1; }
  let mod;
  try {
    mod = await import(`../lib/cli/${spec.module}`);
  } catch (err) {
    if (err && err.code === 'ERR_MODULE_NOT_FOUND') { process.stderr.write(`"${name}" is planned for phase ${spec.phase} and is not implemented yet.\n`); return 2; }
    throw err;
  }
  const code = await mod.run({ flags, args: positionals.slice(1), cwd: process.cwd(), stdout: process.stdout, stderr: process.stderr });
  return Number.isInteger(code) ? code : 0;
}

main().then((code) => { process.exitCode = code; }).catch((err) => { process.stderr.write(`synchrobuilder: ${err && err.stack ? err.stack : err}\n`); process.exitCode = 1; });
