// doctor: record what a working machine looks like, or explain why this one differs. Also checks Synchrobuilder itself.
//   synchrobuilder doctor [path] [--record] [--json]
import path from 'node:path';
import fs from 'node:fs';
import { readManifest } from '../manifest/io.mjs';
import { fingerprint } from '../doctor/fingerprint.mjs';
import { compare } from '../doctor/compare.mjs';
import { pluginChecks } from '../doctor/plugin-checks.mjs';
import { readJson } from '../core/fsx.mjs';
import { locate } from '../core/paths.mjs';

const FINGERPRINT_FILE = path.join('.synchrobuilder', 'fingerprint.json');
const MARK = { blocker: '✖', likely: '!', note: '·' };

export async function run({ args, flags, cwd, stdout, stderr }) {
  const start = path.resolve(cwd, args[0] || '.');
  const loc = locate(start);
  const root = loc ? loc.workTree : start;
  const read = readManifest(root);
  const manifest = read.manifest;
  const fp = await fingerprint(manifest);

  if (flags.record) {
    const file = path.join(root, FINGERPRINT_FILE);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(fp, null, 2) + '\n');
    if (flags.json) stdout.write(JSON.stringify({ recorded: FINGERPRINT_FILE, fingerprint: fp }, null, 2) + '\n');
    else {
      stdout.write(`Recorded this machine to ${FINGERPRINT_FILE}.\n`);
      stdout.write(`  ${fp.os} ${fp.arch}, node ${fp.node}, ${Object.keys(fp.tools).length} tools on PATH\n`);
      stdout.write(`  environment variable names set: ${fp.envNamesSet.length ? fp.envNamesSet.join(', ') : 'none of the ones the manifest lists'}\n`);
      stdout.write('It holds names and versions only, never values. Commit it so teammates can compare against it.\n');
    }
    return 0;
  }

  const reference = readJson(path.join(root, FINGERPRINT_FILE), null);
  const findings = compare(manifest, fp, { fingerprintRef: reference });
  const checks = pluginChecks(start);

  if (flags.json) {
    stdout.write(JSON.stringify({ os: fp.os, arch: fp.arch, node: fp.node, findings, checks, fingerprint: fp }, null, 2) + '\n');
    return findings.some((f) => f.severity === 'blocker') ? 1 : 0;
  }

  stdout.write(`This machine: ${fp.os} ${fp.arch}, node ${fp.node}${reference ? `  (comparing against ${FINGERPRINT_FILE} recorded ${reference.recordedAt})` : ''}\n\n`);
  if (!findings.length) stdout.write('The project matches its manifest on this machine.\n');
  else {
    stdout.write('Project setup, most likely cause first:\n');
    for (const f of findings) {
      stdout.write(`  ${MARK[f.severity]} ${f.title}\n`);
      if (f.detail) stdout.write(`      ${f.detail}\n`);
      if (f.fix) stdout.write(`      fix: ${f.fix}\n`);
    }
  }
  stdout.write('\nSynchrobuilder itself:\n');
  for (const c of checks) {
    stdout.write(`  ${c.ok ? '✓' : '✖'} ${c.title}\n`);
    if (c.detail) stdout.write(`      ${c.detail}\n`);
    if (c.fix) stdout.write(`      fix: ${c.fix}\n`);
  }
  if (!read.exists) stderr.write('\nNo synchrobuilder.json here. Run "synchrobuilder init" on a machine where the project works.\n');
  else if (!read.ok) stderr.write(`\n${read.path} did not validate:\n${read.errors.map((e) => `  ${e}`).join('\n')}\n`);
  return findings.some((f) => f.severity === 'blocker') ? 1 : 0;
}
