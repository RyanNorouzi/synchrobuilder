// Outbound and inbound secret redaction (ADR-005 step 11): one assertion per pattern family, plus the invariants.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, REDACTED } from '../../plugins/synchrobuilder/lib/safety/redact.mjs';

const GHP = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIiwibmFtZSI6IngifQ.abc123def456';

test('vendor token formats become [redacted]', () => {
  const tokens = [
    GHP, 'gho_' + 'x'.repeat(36), 'github_pat_11ABCDEFG0123456789abcdefghijklmnop', 'glpat-abcdefghijklmnopqrstuvwxyz',
    'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789', 'sk-proj-abcdefghijklmnopqrstuvwxyz0123', 'sk-abcdefghijklmnopqrstuvwxyz0123',
    'AKIAIOSFODNN7EXAMPLE', 'ASIAIOSFODNN7EXAMPLE', 'xoxb-1234567890-abcdefghij', 'xoxp-1234567890-abcdefghij',
    'sk_live_abcdefghijklmnopqrstuvwxyz', 'rk_test_abcdefghijklmnopqrstuvwxyz', 'pk_live_abcdefghijklmnopqrstuvwxyz',
    'npm_abcdefghijklmnopqrstuvwxyz0123456789', 'AIzaSyAbcdefghijklmnopqrstuvwxyz0123456789', JWT,
  ];
  for (const t of tokens) {
    const r = redact(`before ${t} after`);
    assert.equal(r.text, `before ${REDACTED} after`, t);
    assert.equal(r.count, 1, t);
  }
});

test('PEM private keys are one redaction even when unterminated or multi-line', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nAAAA\n-----END RSA PRIVATE KEY-----';
  assert.deepEqual(redact(`key:\n${pem}\ndone`), { text: `key:\n${REDACTED}\ndone`, count: 1 });
  assert.deepEqual(redact('-----BEGIN OPENSSH PRIVATE KEY-----\nabc\ncut off'), { text: REDACTED, count: 1 });
});

test('Authorization headers keep the scheme and lose the credential', () => {
  assert.equal(redact(`Authorization: Bearer ${JWT}`).text, `Authorization: Bearer ${REDACTED}`);
  assert.equal(redact('authorization: Basic dXNlcjpwYXNz').text, `authorization: Basic ${REDACTED}`);
  assert.equal(redact('Proxy-Authorization=abcdefgh12345678').text, `Proxy-Authorization=${REDACTED}`);
});

test('credentials inside URLs are removed while scheme and host stay', () => {
  assert.deepEqual(redact('git clone https://bob:hunter2@github.com/x/y.git'), { text: `git clone https://${REDACTED}@github.com/x/y.git`, count: 1 });
  assert.equal(redact('ssh://user:pw@host/repo').text, `ssh://${REDACTED}@host/repo`);
  assert.equal(redact('https://github.com/x/y').count, 0);
});

test('explicit secret-like assignments redact the value; generic 32+ char tokens need a key-like word next to them', () => {
  assert.equal(redact('password=hunter22').text, `password=${REDACTED}`);
  assert.equal(redact('API_KEY: "abcdef123456"').text, `API_KEY: "${REDACTED}"`);
  assert.equal(redact('token is ' + 'a1b2c3d4'.repeat(4)).text, `token is ${REDACTED}`);
  assert.equal(redact('the key was ' + 'Zz'.repeat(20) + '==').text, `the key was ${REDACTED}`);
  // A long hex string with no key-like word nearby is a commit hash, not a secret.
  const sha = 'commit ' + 'abcdef0123456789'.repeat(3);
  assert.deepEqual(redact(sha), { text: sha, count: 0 });
  assert.deepEqual(redact('the token: short'), { text: 'the token: short', count: 0 });
  // Bare "key" and "auth" only trigger the high-entropy rule, so ordinary prose keeps its words.
  for (const prose of ['key: rotate sessions', 'auth = middleware', 'bearer: the person carrying it']) assert.deepEqual(redact(prose), { text: prose, count: 0 }, prose);
});

test('the count is honest: no double redaction, harmless text is unchanged, non-strings give empty', () => {
  assert.equal(redact(`Authorization: Bearer ${JWT}`).count, 1);
  assert.equal(redact(`${GHP} ${GHP}`).count, 2);
  const prose = 'Moved session refresh into middleware; see src/auth.ts and https://docs.example/x for details.';
  assert.deepEqual(redact(prose), { text: prose, count: 0 });
  assert.deepEqual(redact(''), { text: '', count: 0 });
  assert.deepEqual(redact(undefined), { text: '', count: 0 });
  assert.deepEqual(redact(42), { text: '', count: 0 });
});

test('large inputs are handled in linear time', () => {
  const blob = ('password= secret: token ' + 'x'.repeat(31) + ' -----BEGIN PRIVATE KEY----- ').repeat(5000);
  const t0 = process.hrtime.bigint();
  const r = redact(blob);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(r.count >= 1);
  assert.ok(ms < 500, `took ${ms} ms`);
});
