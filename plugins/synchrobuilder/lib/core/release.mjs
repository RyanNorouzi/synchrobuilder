// Where this copy of Synchrobuilder came from, and where it tells people to get it. One place, so the install
// command, the website and the documentation can never disagree about the repository or the marketplace name.
export const PLUGIN_NAME = 'synchrobuilder';
export const MARKETPLACE = 'synchrobuilder';
export const REPO_OWNER = 'RyanNorouzi';
export const REPO_NAME = 'synchrobuilder';
export const REPO_SLUG = `${REPO_OWNER}/${REPO_NAME}`;
export const REPO_URL = `https://github.com/${REPO_SLUG}`;
export const WEBSITE = 'https://synchrobuilder.com/';

/**
 * What to hand `claude plugin marketplace add`. The owner/repo shorthand is shortest and, since Claude Code 2.1.218,
 * falls back to HTTPS when SSH is not configured. SYNCHROBUILDER_MARKETPLACE_SOURCE overrides it for a fork or a
 * local checkout under test.
 */
export function marketplaceSource(env = process.env) {
  const override = env.SYNCHROBUILDER_MARKETPLACE_SOURCE;
  return override && override.trim() ? override.trim() : REPO_SLUG;
}
