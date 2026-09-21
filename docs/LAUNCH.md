# Getting found

A new domain ranks for nothing. The traffic that arrives early comes from places that
already have an audience, so this is a list of those places, roughly in order of
leverage. Everything here was checked on 2026-09-21; forms move, so open each link
before trusting the instructions.

## Done

- **Your own marketplace.** `.claude-plugin/marketplace.json` is live on the default
  branch, so `/plugin marketplace add RyanNorouzi/synchrobuilder` works for anyone today.
- **npm.** Published as [`synchrobuilder`](https://www.npmjs.com/package/synchrobuilder).
  Keywords deliberately favour scarce terms (`portability` has about 56 packages)
  over crowded ones (`claude-code` has about 22,000).
- **GitHub topics and homepage.** Ten topics and the site as the repository homepage,
  which is also the domain's first crawlable backlink.

## Worth doing, in this order

1. **Anthropic's community marketplace** — the single highest-leverage channel.
   Submit at https://platform.claude.com/plugins/submit. A console form, open to
   individual authors with no organization required.
2. **pluginmarketplace.ai** — https://pluginmarketplace.ai/submit. A real submission
   form, takes a minute.
3. **awesome-claude-code** — the canonical list, at
   https://github.com/hesreallyhim/awesome-claude-code. Use the issue form only; their
   contributing guide says pull requests risk being restricted.
4. **Secondary awesome-lists** that take a one-line pull request:
   https://github.com/ccplugins/awesome-claude-code-plugins,
   https://github.com/composio-community/awesome-claude-plugins.
5. **Google Search Console** — https://search.google.com/search-console. Verify by DNS
   TXT, then submit `https://synchrobuilder.com/sitemap.xml`. Without this you wait for
   an organic crawl, which can take weeks.
6. **Show HN** — https://news.ycombinator.com/showhn.html. Title as
   "Show HN: Synchrobuilder – ..." and post around 8 to 9am Eastern.
7. **Reddit** r/ClaudeAI and r/ClaudeCode. Read each sidebar's self-promotion rules
   first; they differ and are enforced.

Two directories index automatically with no form:
[claude-plugins.dev](https://github.com/Kamalnrf/claude-plugins) discovers public
marketplaces on its own, and [claudemarketplaces.com](https://claudemarketplaces.com)
ranks by install count and stars.

## The blurb to paste

> Synchrobuilder audits your project for the things that work on one operating system
> and break on another, from import path casing to Unix-only npm scripts, and proposes
> each fix as a diff you approve. It also lets several developers each run their own
> Claude Code in one repo and see each other's presence, file claims, messages and
> handoffs over the git remote you already have, so there is nothing to host and no
> account to create.

## What not to chase

- **"claude code plugin"** is owned by Anthropic's own documentation and several
  index-scale aggregators. There are about 75,000 GitHub repositories on that topic.
- **"works on my machine"** is a joke phrase with stickers and certifications behind
  it, not a search with intent.
- **"best AI coding tools 2026"** listicles are refreshed monthly by sites with years
  of authority.
- **Windows path limits, CRLF, python vs python3** belong to Microsoft Learn and Stack
  Overflow permanently. Use them as sections on a page, never as ranking targets.

The winnable ground is narrower and duller: import path casing that breaks on Linux,
Unix-only npm scripts failing on Windows, cross-platform compatibility checking for
Node projects. Those searches are answered today by scattered blog posts and issue
threads, and no vendor owns them.
