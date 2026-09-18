# Security policy

## Reporting a vulnerability

Until the repository is public, write to the maintainers at the placeholder
address `hello@example.invalid`. Once it is public, use GitHub's private
vulnerability reporting on the repository. Please include the plugin version
(`npx synchrobuilder --version`), your operating system, and steps to
reproduce. We will acknowledge reports and keep you informed; we do not yet
promise a fixed response time.

## What Synchrobuilder does with your data

- Hooks read local files only and never call the network.
- The background worker pushes only: your handle, branch name, a task summary
  of at most 140 characters, repo-relative file paths, short messages,
  structured handoff notes, task board entries and claims. Everything passes
  secret redaction first.
- It never sends prompts, transcripts, file contents, diffs, environment
  variable values, or your email address (see `docs/adr/ADR-002-identity.md`
  for the one opt-in exception for hosts with author rules).
- Text that arrives from other machines is treated as untrusted data and
  wrapped as such before Claude sees it (`docs/adr/ADR-005-teammate-message-security.md`).

## Trust model

Identity is a claim, not authentication: anyone with push access to your
remote can write any team state. Synchrobuilder trusts your repository's
access control and nothing else. Public repositories publish presence and
messages to the world.

## Supply chain

No runtime dependencies, no build step. What is in this repository is what
runs. Releases are tagged; the plugin version is the cache key Claude Code
uses for updates.
