// Native and platform-specific dependencies: packages that compile with node-gyp or download per-platform binaries
// install fine on the author's machine and fail on a teammate's (Apple Silicon vs x64, Windows without build tools).
// esbuild and friends ship prebuilt binaries for every platform and are deliberately not listed.
import fs from 'node:fs';
import path from 'node:path';
import { lineOf } from '../engine.mjs';

const MAX_LOCK_BYTES = 8 * 1024 * 1024;
const LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock'];
const PLATFORM_TOKENS = /\b(darwin-arm64|win32-x64|darwin-x64|linux-x64|linux-arm64|win32-ia32|win32-arm64)\b/g;
const PLATFORM_NAME = /(darwin|linux|win32|freebsd|android|openbsd|sunos|aix)[-_]?(arm64|x64|ia32|arm|ppc64|s390x)?|(arm64|x64|ia32)[-_](musl|gnu|msvc)|[-_](musl|gnu|msvc)$/i;
// Package name -> why it is a portability risk. Keep the reason short; it is shown verbatim.
export const NATIVE_PACKAGES = new Map([
  ['sqlite3', 'compiles with node-gyp when no prebuilt binary matches the Node version, OS and CPU'],
  ['better-sqlite3', 'compiles with node-gyp when no prebuilt binary matches the Node version, OS and CPU'],
  ['bcrypt', 'compiles with node-gyp when no prebuilt binary matches (use bcryptjs for a pure-JS drop-in)'],
  ['canvas', 'needs Cairo and Pango system libraries or a prebuilt binary for the exact OS and CPU'],
  ['sharp', 'downloads a libvips binary per OS and CPU; Apple Silicon and Windows x64 get different files'],
  ['node-sass', 'deprecated node-gyp build that fails on recent Node; replace with the pure-JS "sass" package'],
  ['fsevents', 'macOS only; must be optional so npm install succeeds on Linux and Windows'],
  ['puppeteer', 'downloads a Chromium build per OS at install time; corporate networks and CI often block it'],
  ['playwright', 'downloads browser builds per OS; install must run "playwright install" on every machine'],
  ['@swc/core', 'loads a per-platform binary package (@swc/core-darwin-arm64, @swc/core-win32-x64-msvc, ...)'],
  ['keytar', 'compiles against libsecret on Linux and needs build tools where no prebuilt binary matches'],
  ['serialport', 'compiles with node-gyp when no prebuilt binary matches; needs Visual Studio Build Tools on Windows'],
  ['usb', 'compiles libusb bindings with node-gyp; needs Visual Studio Build Tools on Windows'],
  ['cpu-features', 'compiles with node-gyp on every install; needs build tools on Windows'],
  ['re2', 'compiles the RE2 C++ library with node-gyp when no prebuilt binary matches'],
  ['node-pty', 'compiles with node-gyp; needs Python and Visual Studio Build Tools on Windows'],
  ['argon2', 'compiles with node-gyp when no prebuilt binary matches'],
  ['sodium-native', 'compiles libsodium bindings when no prebuilt binary matches'],
  ['leveldown', 'compiles LevelDB with node-gyp when no prebuilt binary matches'],
  ['nodegit', 'compiles libgit2 with node-gyp; long builds and frequent failures on Windows and Apple Silicon'],
  ['robotjs', 'compiles with node-gyp and needs X11 headers on Linux'],
  ['@tensorflow/tfjs-node', 'downloads a per-platform TensorFlow binary; Apple Silicon needs a different build'],
  ['onnxruntime-node', 'ships per-platform binaries; check the version supports every CPU your team uses'],
  ['bufferutil', 'compiles with node-gyp when no prebuilt binary matches (ws works without it)'],
  ['utf-8-validate', 'compiles with node-gyp when no prebuilt binary matches (ws works without it)'],
]);
const FIX = 'Pin a version that publishes prebuilt binaries for every OS and CPU your team uses (check the package\'s releases for darwin-arm64, darwin-x64, win32-x64 and linux-x64), prefer a pure-JS alternative where one exists, and add each platform to CI so a broken install is caught before a teammate hits it.';
const RISK = 'A lockfile resolved on Apple Silicon can pin darwin-arm64 binaries an x64 or Windows teammate cannot use, and a package without a prebuilt binary falls back to node-gyp, which needs Python and Visual Studio Build Tools on Windows.';

function lineOfKey(content, name) {
  const at = content.indexOf(`"${name}"`);
  return at === -1 ? undefined : lineOf(content, at);
}

function packageFindings(rel, content) {
  let pkg;
  try { pkg = JSON.parse(content); } catch { return []; }
  if (!pkg || typeof pkg !== 'object') return [];
  const findings = [];
  const seen = new Set();
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const deps = pkg[section];
    if (!deps || typeof deps !== 'object') continue;
    for (const name of Object.keys(deps)) {
      if (seen.has(name)) continue;
      const reason = NATIVE_PACKAGES.get(name);
      const platformNamed = section === 'optionalDependencies' && PLATFORM_NAME.test(name);
      if (!reason && !platformNamed) continue;
      seen.add(name);
      const why = reason || 'is a per-platform binary package; the lockfile must list every platform variant or teammates on other machines get "unsupported platform"';
      findings.push({ file: rel, line: lineOfKey(content, name), message: `${section}: "${name}" ${why}. ${RISK}`, fix: FIX, data: { name, section } });
    }
  }
  if (Array.isArray(pkg.os) || Array.isArray(pkg.cpu)) {
    findings.push({ file: rel, line: lineOfKey(content, Array.isArray(pkg.os) ? 'os' : 'cpu'), message: `package.json restricts installation with "os"/"cpu" (${[...(pkg.os || []), ...(pkg.cpu || [])].join(', ')}); npm refuses to install it anywhere else.`, fix: 'Remove the restriction or make the platform-specific part an optionalDependency with a portable fallback.', data: { os: pkg.os, cpu: pkg.cpu } });
  }
  return findings;
}

/** Reads the head of a lockfile directly because the index refuses files over its size cap and lockfiles are big. */
function readHead(repoRoot, rel, maxBytes) {
  let fd = null;
  try {
    fd = fs.openSync(path.join(repoRoot, rel), 'r');
    const size = Math.min(fs.fstatSync(fd).size, maxBytes);
    const buf = Buffer.alloc(size);
    const n = fs.readSync(fd, buf, 0, size, 0);
    return buf.toString('utf8', 0, n);
  } catch { return null; } finally { if (fd !== null) { try { fs.closeSync(fd); } catch { /* already closed */ } } }
}

function lockFindings(repoRoot, rel) {
  const text = readHead(repoRoot, rel, MAX_LOCK_BYTES);
  if (!text) return [];
  const counts = new Map();
  let first = -1;
  PLATFORM_TOKENS.lastIndex = 0;
  let m;
  while ((m = PLATFORM_TOKENS.exec(text))) {
    if (first === -1) first = m.index;
    counts.set(m[1], (counts.get(m[1]) || 0) + 1);
  }
  if (!counts.size) return [];
  const list = [...counts].map(([k, v]) => `${k} x${v}`).join(', ');
  return [{ file: rel, line: lineOf(text, first), message: `Lockfile pins platform-specific binary packages (${list}). ${RISK}`, fix: 'Make sure the lockfile lists the variant for every OS and CPU your team uses (npm install --os/--cpu, or run install once per platform in CI) and commit the result.', data: { platforms: Object.fromEntries(counts) } }];
}

export default {
  id: 'native-deps',
  severity: 'low',
  title: 'Dependencies that need native compilation or platform binaries',
  explain: 'Packages built with node-gyp or shipped as per-platform binaries install on one machine and fail on another: Apple Silicon versus x64, Linux versus Windows without build tools. Pin versions with prebuilt binaries and test every platform in CI.',
  scope: 'project',
  check({ repoRoot, index }) {
    const findings = [];
    for (const rel of index.files) {
      if (!/(^|\/)package\.json$/.test(rel)) continue;
      const content = index.read(rel);
      if (content !== null) findings.push(...packageFindings(rel, content));
    }
    for (const lock of LOCKFILES) if (index.has(lock)) findings.push(...lockFindings(repoRoot, lock));
    return findings;
  },
};
