// Per-OS install recipes for runtimes and services (ADR-004, PLAN Phase 4).
// Every recipe returns either { command: argv[] } for a program we can spawn without a shell, or { manual: string }
// for anything that needs sudo, a shell function (nvm) or a package id we cannot vouch for. Nothing here elevates.
// Package ids are best-effort guesses from the vendors' public catalogues; they are NOT verified by a test in this
// repository, which is why every manual line tells the user how to double-check them.

export function osKey(platform) {
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'macos';
  return 'linux';
}

export function majorOf(version) {
  const m = String(version || '').replace(/^v/, '').match(/^(\d+)/);
  return m ? Number(m[1]) : null;
}

export function majorMinorOf(version) {
  const m = String(version || '').replace(/^v/, '').match(/^(\d+\.\d+)/);
  return m ? m[1] : null;
}

/** Winget catalogue id for a runtime at an exact version. Even Node majors are the LTS line. */
function wingetRuntimeId(name, version) {
  const major = majorOf(version);
  switch (name) {
    case 'node': return major !== null && major % 2 === 0 ? 'OpenJS.NodeJS.LTS' : 'OpenJS.NodeJS';
    case 'python': return `Python.Python.${majorMinorOf(version) || '3'}`;
    case 'go': return 'GoLang.Go';
    case 'ruby': return `RubyInstallerTeam.Ruby.${majorMinorOf(version) || ''}`.replace(/\.$/, '');
    case 'java': return `EclipseAdoptium.Temurin.${major || ''}.JDK`;
    default: return null;
  }
}

function brewRuntimeFormula(name, version) {
  const major = majorOf(version);
  switch (name) {
    case 'node': return major ? `node@${major}` : 'node';
    case 'python': return `python@${majorMinorOf(version) || '3'}`;
    case 'go': return 'go';
    case 'ruby': return 'ruby';
    case 'java': return major ? `openjdk@${major}` : 'openjdk';
    default: return null;
  }
}

function aptRuntimePackage(name, version) {
  const major = majorOf(version);
  switch (name) {
    case 'node': return 'nodejs';
    case 'python': return 'python3';
    case 'go': return 'golang-go';
    case 'ruby': return 'ruby-full';
    case 'java': return major ? `openjdk-${major}-jdk` : 'default-jdk';
    default: return null;
  }
}

/**
 * Recipe for installing runtime `name` at exact `version` using a version manager found on PATH, if any.
 * nvm on POSIX is a shell function, so it can only ever be a manual step; the others are real programs.
 */
export function versionManagerRecipe(name, version, managers, platform) {
  if (name !== 'node') return null;
  if (managers.includes('volta')) return { tool: 'volta', command: ['volta', 'install', `node@${version}`] };
  if (managers.includes('fnm')) return { tool: 'fnm', command: ['fnm', 'install', version], note: `then run "fnm use ${version}" in your shell` };
  if (managers.includes('nvm')) {
    if (platform === 'win32') return { tool: 'nvm-windows', command: ['nvm', 'install', version], note: `then run "nvm use ${version}" (nvm-windows may ask for elevation)` };
    return { tool: 'nvm', manual: `nvm install ${version} && nvm use ${version}`, note: 'nvm is a shell function, so Synchrobuilder cannot run it for you' };
  }
  return null;
}

/** Recipe for installing a runtime with the OS-native package manager. apt needs sudo, so Linux is always manual. */
export function nativeRuntimeRecipe(name, version, platform, tools = []) {
  if (platform === 'win32') {
    const id = wingetRuntimeId(name, version);
    if (!id) return { manual: `Install ${name} ${version} for Windows (try: winget search ${name})` };
    // --exact pins the id; the agreement flags stop winget from waiting on a prompt we cannot answer through a pipe.
    if (!tools.includes('winget')) return { manual: `winget install --id ${id} --version ${version} --exact  (winget was not found on PATH)` };
    return { command: ['winget', 'install', '--id', id, '--version', version, '--exact', '--accept-package-agreements', '--accept-source-agreements'], note: 'accepts the package licence on your behalf' };
  }
  if (platform === 'darwin') {
    const formula = brewRuntimeFormula(name, version);
    if (!formula) return { manual: `Install ${name} ${version} for macOS (try: brew search ${name})` };
    if (!tools.includes('brew')) return { manual: `brew install ${formula}  (Homebrew was not found on PATH; see https://brew.sh)` };
    return { command: ['brew', 'install', formula], note: `Homebrew installs the newest ${formula} release, which may not be exactly ${version}; use fnm or volta for an exact pin` };
  }
  const pkg = aptRuntimePackage(name, version);
  if (!pkg) return { manual: `Install ${name} ${version} with your distribution's package manager` };
  return { manual: `sudo apt-get update && sudo apt-get install -y ${pkg}`, note: `needs sudo, so run it yourself; apt may not ship exactly ${version}` };
}

const SERVICE_PACKAGES = {
  postgres: { winget: (v) => `PostgreSQL.PostgreSQL.${majorOf(v) || 16}`, brew: (v) => `postgresql@${majorOf(v) || 16}`, apt: (v) => `postgresql-${majorOf(v) || 16}` },
  postgresql: { winget: (v) => `PostgreSQL.PostgreSQL.${majorOf(v) || 16}`, brew: (v) => `postgresql@${majorOf(v) || 16}`, apt: (v) => `postgresql-${majorOf(v) || 16}` },
  redis: { winget: null, brew: () => 'redis', apt: () => 'redis-server' },
  mysql: { winget: () => 'Oracle.MySQL', brew: () => 'mysql', apt: () => 'mysql-server' },
  mongodb: { winget: () => 'MongoDB.Server', brew: () => 'mongodb-community', apt: () => 'mongodb-org' },
};

/** Exact manual command for a service on this OS. Services are never started by Synchrobuilder itself. */
export function serviceRecipe(service, platform) {
  const known = SERVICE_PACKAGES[String(service.name || '').toLowerCase()];
  const label = `${service.name}${service.version ? ' ' + service.version : ''}`;
  if (platform === 'win32') {
    const id = known && known.winget ? known.winget(service.version) : null;
    return id ? `winget install --id ${id} --exact` : `Install ${label} for Windows (try: winget search ${service.name}, or use Docker / WSL)`;
  }
  if (platform === 'darwin') {
    const formula = known ? known.brew(service.version) : null;
    return formula ? `brew install ${formula} && brew services start ${formula}` : `Install ${label} for macOS (try: brew search ${service.name})`;
  }
  const pkg = known ? known.apt(service.version) : null;
  return pkg ? `sudo apt-get install -y ${pkg} && sudo systemctl enable --now ${pkg.split('-')[0]}` : `Install ${label} with your distribution's package manager`;
}
