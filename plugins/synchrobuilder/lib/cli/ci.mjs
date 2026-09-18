// ci: generate a three-OS GitHub Actions workflow from synchrobuilder.json, plus the README badge.
//   synchrobuilder ci [path] [--write] [--json]
import path from 'node:path';
import fs from 'node:fs';
import { readManifest } from '../manifest/io.mjs';
import { generateWorkflow, badgeSnippet, inferRepoSlug } from '../ci/workflow.mjs';
import { locate } from '../core/paths.mjs';

const WORKFLOW_PATH = path.join('.github', 'workflows', 'verify.yml');

export async function run({ args, flags, cwd, stdout, stderr }) {
  const start = path.resolve(cwd, args[0] || '.');
  const loc = locate(start);
  const root = loc ? loc.workTree : start;
  const read = readManifest(root);
  if (!read.exists) { stderr.write('No synchrobuilder.json here. Run "synchrobuilder init" first.\n'); return 1; }
  if (!read.ok) { stderr.write(`${read.path} did not validate:\n${read.errors.map((e) => `  ${e}`).join('\n')}\n`); return 1; }
  const manifest = read.manifest;
  const yaml = generateWorkflow(manifest);
  const slug = inferRepoSlug(loc && loc.remoteUrl);
  const badge = badgeSnippet(manifest, slug);

  if (flags.json) { stdout.write(JSON.stringify({ path: WORKFLOW_PATH, workflow: yaml, badge }, null, 2) + '\n'); if (!flags.write) return 0; }

  if (!flags.write) {
    stdout.write(`${WORKFLOW_PATH}\n\n${yaml}\n`);
    stdout.write(`README badge:\n\n${badge}\n\n`);
    stdout.write(`Nothing was written. To write the workflow: synchrobuilder ci --write\n`);
    return 0;
  }
  const file = path.join(root, WORKFLOW_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, yaml);
  if (!flags.json) {
    stdout.write(`Wrote ${WORKFLOW_PATH}\n\nAdd this to your README:\n\n${badge}\n\n`);
    stdout.write('Commit and push, then check the Actions tab. The badge is honest only after the workflow runs.\n');
  }
  return 0;
}
