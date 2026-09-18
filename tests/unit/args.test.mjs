import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../../plugins/synchrobuilder/lib/core/args.mjs';
test('parseArgs handles flags, values and positionals', () => {
  const r = parseArgs(['audit', 'src', '--json', '--only=a,b', '--scope', 'user', '--', '--literal'], { booleans: ['json'] });
  assert.deepEqual(r.positionals, ['audit', 'src', '--literal']);
  assert.equal(r.flags.json, true);
  assert.equal(r.flags.only, 'a,b');
  assert.equal(r.flags.scope, 'user');
});
