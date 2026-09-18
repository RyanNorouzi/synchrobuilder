// Compare a machine against the manifest (and, when there is one, against a fingerprint recorded on a machine where
// the project works). Findings come out ordered: the thing most likely to be the actual problem first.
import { forOs } from '../manifest/schema.mjs';

const ORDER = { blocker: 0, likely: 1, note: 2 };

/** Install advice for one runtime or tool on one operating system. Text only: nothing is ever run from here. */
export function installHint(name, version, osName) {
  const v = version ? `@${version}` : '';
  const table = {
    node: {
      windows: `winget install OpenJS.NodeJS.LTS${version ? ` --version ${version}` : ''}   (or: nvm install ${version || 'lts'})`,
      macos: `brew install node${version ? `@${version.split('.')[0]}` : ''}   (or: nvm install ${version || '--lts'})`,
      linux: `nvm install ${version || '--lts'}   (or your distribution's nodejs package, which is often older)`,
    },
    python: {
      windows: `winget install Python.Python.${version ? version.split('.').slice(0, 2).join('.') : '3.12'}`,
      macos: `brew install python@${version ? version.split('.').slice(0, 2).join('.') : '3.12'}`,
      linux: `sudo apt-get install python3 python3-venv   (needs your password; run it yourself)`,
    },
    git: { windows: 'winget install Git.Git', macos: 'brew install git   (macOS also ships one with Xcode command line tools)', linux: 'sudo apt-get install git' },
    docker: { windows: 'winget install Docker.DockerDesktop', macos: 'brew install --cask docker', linux: 'follow https://docs.docker.com/engine/install/ for your distribution' },
    pnpm: { windows: 'corepack enable && corepack prepare pnpm' + v + ' --activate', macos: 'corepack enable && corepack prepare pnpm' + v + ' --activate', linux: 'corepack enable && corepack prepare pnpm' + v + ' --activate' },
    yarn: { windows: 'corepack enable && corepack prepare yarn' + v + ' --activate', macos: 'corepack enable && corepack prepare yarn' + v + ' --activate', linux: 'corepack enable && corepack prepare yarn' + v + ' --activate' },
  };
  const row = table[name];
  if (row) return row[osName] || row.linux;
  return `install ${name}${version ? ` ${version}` : ''} the way your operating system prefers`;
}

function serviceHint(name, osName) {
  const table = {
    postgres: { windows: 'winget install PostgreSQL.PostgreSQL, or run it with Docker', macos: 'brew install postgresql && brew services start postgresql', linux: 'sudo apt-get install postgresql && sudo service postgresql start' },
    redis: { windows: 'run it with Docker: docker run -p 6379:6379 redis', macos: 'brew install redis && brew services start redis', linux: 'sudo apt-get install redis-server' },
    mysql: { windows: 'winget install Oracle.MySQL, or run it with Docker', macos: 'brew install mysql && brew services start mysql', linux: 'sudo apt-get install mysql-server' },
    mongodb: { windows: 'run it with Docker: docker run -p 27017:27017 mongo', macos: 'brew tap mongodb/brew && brew install mongodb-community', linux: 'follow MongoDB\'s installation guide for your distribution' },
  };
  const row = table[String(name).toLowerCase().replace(/[^a-z]/g, '')];
  return row ? (row[osName] || row.linux) : `start ${name} however your team runs it, or use docker compose up`;
}

function majorOf(v) { return String(v || '').replace(/^v/, '').split('.')[0]; }

/**
 * @returns [{ severity, title, detail, fix }] ordered blocker, likely, note.
 */
export function compare(manifest, fp, { fingerprintRef = null, osName = fp && fp.os } = {}) {
  const findings = [];
  const add = (severity, title, detail, fix) => findings.push({ severity, title, detail, fix });
  if (!manifest) {
    add('blocker', 'No synchrobuilder.json', 'This project has no manifest, so there is nothing to compare against.', 'Run "synchrobuilder init" on a machine where the project works, and commit the file.');
    return findings;
  }
  const { runtimes, commands } = forOs(manifest, osName);

  for (const r of runtimes) {
    const installed = fp.tools[r.name] || (r.name === 'node' ? { version: fp.node.replace(/^v/, '') } : null);
    if (!installed) {
      add('blocker', `${r.name} is not installed`, `The project needs ${r.name} ${r.version}, and ${r.name} was not found on PATH.`, installHint(r.name, r.version, osName));
      continue;
    }
    if (r.version && !installed.version) {
      add('note', `${r.name} is installed but did not report a version`, `The project pins ${r.version}; Synchrobuilder could not read what is installed.`, `Run "${r.detect || `${r.name} --version`}" yourself and compare with ${r.version}.`);
      continue;
    }
    if (r.version && installed.version !== r.version) {
      const sameMajor = majorOf(installed.version) === majorOf(r.version);
      add(sameMajor ? 'note' : 'likely', `${r.name} is ${installed.version}, the project pins ${r.version}`,
        sameMajor ? 'Same major version, so most things will work.' : 'A different major version is the usual cause of "works on my machine".',
        installHint(r.name, r.version, osName));
    }
  }

  const pm = manifest.packageManager;
  if (pm && pm.name && !fp.tools[pm.name]) {
    add('blocker', `${pm.name} is not installed`, `The project installs dependencies with ${pm.name}${pm.version ? ` ${pm.version}` : ''}.`, installHint(pm.name, pm.version, osName));
  } else if (pm && pm.name && pm.version && fp.tools[pm.name] && fp.tools[pm.name].version !== pm.version) {
    add('note', `${pm.name} is ${fp.tools[pm.name].version}, the project pins ${pm.version}`, 'A different package manager version can resolve dependencies differently.', installHint(pm.name, pm.version, osName));
  }

  for (const s of fp.services) {
    if (s.reachable === false) {
      const declared = (manifest.services || []).find((x) => x.name === s.name) || {};
      add('likely', `${s.name} is not answering on port ${s.port}`, declared.hint || `The project expects ${s.name}${declared.version ? ` ${declared.version}` : ''} to be running.`, serviceHint(s.name, osName));
    }
  }

  for (const name of fp.envNamesMissing) {
    const declared = (manifest.env || []).find((e) => e.name === name) || {};
    add(declared.required === false ? 'note' : 'likely', `${name} is not set`, declared.description || 'The project reads this environment variable.', `Set ${name} in your shell or in a local .env file. Synchrobuilder never stores its value.`);
  }

  if (fingerprintRef) {
    for (const [name, ref] of Object.entries(fingerprintRef.tools || {})) {
      const here = fp.tools[name];
      if (here && ref.version && here.version !== ref.version && !runtimes.some((r) => r.name === name)) {
        add('note', `${name} differs from the recorded machine`, `here ${here.version}, recorded ${ref.version}`, 'Usually harmless; worth checking if the failure is in that tool.');
      }
    }
    if (fingerprintRef.arch && fingerprintRef.arch !== fp.arch) {
      add('note', `Different CPU architecture (${fp.arch} here, ${fingerprintRef.arch} recorded)`, 'Native dependencies built for one architecture do not run on the other.', 'Reinstall dependencies on this machine rather than copying node_modules.');
    }
  }

  if (!commands.install) add('note', 'No install command in the manifest', 'Setup cannot install dependencies for a teammate.', 'Add commands.install to synchrobuilder.json.');
  findings.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  return findings;
}
