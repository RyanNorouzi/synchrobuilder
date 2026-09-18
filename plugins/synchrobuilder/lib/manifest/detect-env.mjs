// Environment variable names from example files, and services implied by their names.
// Reads .env.example / .env.sample / .env.template only. It never opens .env: that file holds real values.
import path from 'node:path';
import { readText } from '../core/fsx.mjs';
import { redact } from '../safety/redact.mjs';

export const ENV_EXAMPLE_FILES = Object.freeze(['.env.example', '.env.sample', '.env.template', '.env.dist']);
const MAX_DESCRIPTION = 140;
const RE_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

function cleanComment(line) {
  const s = line.replace(/^\s*#+\s?/, '').replace(/[\x00-\x1f\x7f-\x9f]/g, '').replace(/\s+/g, ' ').trim();
  return redact(s).text;
}

/** Parse one example file. Values are discarded on the spot; only the name, whether the example left it blank, and nearby comments survive. */
export function parseEnvExample(text) {
  const out = [];
  const seen = new Set();
  let comments = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { comments = []; continue; }
    if (line.startsWith('#')) { comments.push(cleanComment(line)); continue; }
    const m = raw.match(RE_LINE);
    if (!m) { comments = []; continue; }
    const name = m[1];
    const rest = m[2];
    // A trailing "# comment" on the same line describes the variable too. The value part is dropped unread.
    const inline = rest.match(/\s#\s*(.*)$/);
    const blank = rest.replace(/\s#.*$/, '').trim().replace(/^["']|["']$/g, '') === '';
    if (!seen.has(name)) {
      seen.add(name);
      const parts = [...comments, inline ? cleanComment('# ' + inline[1]) : ''].filter((c) => c && !/^-+$|^=+$/.test(c));
      let description = parts.join(' ');
      if (description.length > MAX_DESCRIPTION) description = description.slice(0, MAX_DESCRIPTION - 1).trimEnd() + '…';
      out.push({ name, description, blankInExample: blank });
    }
    comments = [];
  }
  return out;
}

/** Env entries for the manifest from the first example file present, plus which file it came from. */
export function detectEnv(root) {
  for (const file of ENV_EXAMPLE_FILES) {
    const text = readText(path.join(root, file), null);
    if (text === null) continue;
    const entries = parseEnvExample(text).map((e) => {
      const env = { name: e.name, required: true };
      if (e.description) env.description = e.description;
      return env;
    });
    return { file, entries, unsure: entries.length ? [{ field: 'env[].required', reason: `every name in ${file} is marked required; set required: false on optional ones` }] : [] };
  }
  return { file: null, entries: [], unsure: [] };
}

const NAME_HINTS = [
  { re: /^(DATABASE_URL|POSTGRES(QL)?_(URL|HOST|DB|USER|PASSWORD)|PG(HOST|DATABASE|USER))$/i, service: 'postgres', port: 5432 },
  { re: /^(MYSQL_(URL|HOST|DATABASE|USER)|MARIADB_(URL|HOST))$/i, service: 'mysql', port: 3306 },
  { re: /^(REDIS_(URL|HOST|PORT)|REDISCLOUD_URL)$/i, service: 'redis', port: 6379 },
  { re: /^(MONGO(DB)?_(URL|URI|HOST)|MONGODB_CONNECTION_STRING)$/i, service: 'mongo', port: 27017 },
  { re: /^(RABBITMQ_URL|AMQP_URL)$/i, service: 'rabbitmq', port: 5672 },
  { re: /^(ELASTICSEARCH_URL|ELASTIC_URL)$/i, service: 'elasticsearch', port: 9200 },
];

/** Services suggested by env names alone (no version known). DATABASE_URL usually means Postgres but not always, so these are unsure. */
export function servicesFromEnvNames(names) {
  const out = [];
  for (const name of names) {
    const hit = NAME_HINTS.find((h) => h.re.test(name));
    if (hit && !out.some((s) => s.name === hit.service)) out.push({ name: hit.service, port: hit.port, hint: `Suggested by the ${name} variable` });
  }
  return out;
}
