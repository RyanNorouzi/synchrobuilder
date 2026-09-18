// Services from docker-compose files and build targets from a Makefile. Both are read as text with a
// deliberately small parser: we only need image names, published ports and target names, not a full YAML or make grammar.
import fs from 'node:fs';
import path from 'node:path';
import { readText } from '../core/fsx.mjs';

const COMPOSE_NAMES = /^(docker-)?compose(\.[A-Za-z0-9_-]+)?\.ya?ml$/;
const IMAGES = [
  { re: /(^|\/)(postgres|postgresql)$/, name: 'postgres', port: 5432 },
  { re: /(^|\/)(mysql|mariadb)$/, name: 'mysql', port: 3306 },
  { re: /(^|\/)redis$/, name: 'redis', port: 6379 },
  { re: /(^|\/)(mongo|mongodb)$/, name: 'mongo', port: 27017 },
  { re: /(^|\/)rabbitmq$/, name: 'rabbitmq', port: 5672 },
  { re: /(^|\/)elasticsearch$/, name: 'elasticsearch', port: 9200 },
];

export function listComposeFiles(root) {
  try { return fs.readdirSync(root).filter((n) => COMPOSE_NAMES.test(n)).sort().map((n) => path.join(root, n)); } catch { return []; }
}

/** Split "registry/name:tag" into { repo, tag }. Digests and registries with ports are handled by looking at the last path segment. */
function splitImage(image) {
  const s = image.trim().replace(/^["']|["']$/g, '').replace(/@sha256:.*$/, '');
  const lastSlash = s.lastIndexOf('/');
  const tail = s.slice(lastSlash + 1);
  const colon = tail.indexOf(':');
  const tag = colon === -1 ? null : tail.slice(colon + 1);
  const repo = (colon === -1 ? s : s.slice(0, lastSlash + 1) + tail.slice(0, colon)).toLowerCase();
  return { repo, tag };
}

function versionFromTag(tag) {
  if (!tag) return null;
  const m = tag.match(/^(\d+(?:\.\d+){0,3})/);
  return m ? m[1] : null;
}

/** Blocks under "services:" of a compose file: [{ service, image, ports: ['5433:5432'] }]. Indentation-based, tolerant of noise. */
export function parseComposeServices(text) {
  const lines = String(text).split(/\r?\n/);
  const out = [];
  let inServices = false;
  let current = null;
  let serviceIndent = -1;
  const portsIn = (s) => [...String(s).matchAll(/["']?(\d[0-9.:]*:\d+)["']?/g)].map((m) => m[1]);
  for (const raw of lines) {
    const line = raw.replace(/\s+#.*$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.match(/^\s*/)[0].length;
    const kv = line.match(/^\s*([A-Za-z0-9_.-]+):(?:\s+(.*))?$/);
    if (indent === 0) { inServices = !!kv && kv[1] === 'services'; current = null; serviceIndent = -1; continue; }
    if (!inServices) continue;
    if (kv) {
      if (serviceIndent === -1 || indent === serviceIndent) {
        serviceIndent = indent;
        current = { service: kv[1], image: null, ports: [], collecting: false };
        out.push(current);
        continue;
      }
      if (!current || indent < serviceIndent) continue;
      if (kv[1] === 'image' && kv[2]) current.image = kv[2].trim();
      // "ports:" starts a list on the following lines; an inline list ("ports: [...]") is taken right away.
      current.collecting = kv[1] === 'ports' && !kv[2];
      if (kv[1] === 'ports' && kv[2]) current.ports.push(...portsIn(kv[2]));
      continue;
    }
    if (current && current.collecting && /^\s*-\s/.test(line)) current.ports.push(...portsIn(line));
  }
  return out;
}

/** Manifest service entries from every compose file in the root. Host ports come from "host:container" mappings; else the image default. */
export function detectComposeServices(root) {
  const services = [];
  const unsure = [];
  for (const file of listComposeFiles(root)) {
    const text = readText(file, '');
    for (const block of parseComposeServices(text)) {
      if (!block.image) continue;
      const { repo, tag } = splitImage(block.image);
      const known = IMAGES.find((i) => i.re.test(repo));
      if (!known || services.some((s) => s.name === known.name)) continue;
      const svc = { name: known.name, port: known.port, hint: `From ${path.basename(file)} service "${block.service}" (image ${block.image})` };
      const version = versionFromTag(tag);
      if (version) svc.version = version; else unsure.push({ field: `services.${known.name}.version`, reason: `image ${block.image} has no numeric tag` });
      const mapping = block.ports.map((p) => p.split(':')).find((parts) => parts.length >= 2 && Number(parts[parts.length - 1]) === known.port);
      if (mapping) { const host = Number(mapping[mapping.length - 2]); if (Number.isInteger(host) && host > 0) svc.port = host; }
      services.push(svc);
    }
  }
  return { services, unsure };
}

const MAKE_TARGETS = ['install', 'build', 'migrate', 'seed', 'start', 'dev', 'test'];

/** Target names in a Makefile that map to manifest commands. */
export function detectMakeTargets(root) {
  const text = readText(path.join(root, 'Makefile'), null) ?? readText(path.join(root, 'makefile'), null);
  if (text === null) return { targets: [], present: false };
  const targets = new Set();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+)\s*:(?!=)/);
    if (m && MAKE_TARGETS.includes(m[1])) targets.add(m[1]);
  }
  return { targets: [...targets], present: true };
}
