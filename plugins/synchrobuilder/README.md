# Synchrobuilder

**Multiplayer Claude Code for teams on any laptop. No server, safe by design.**

[![ci](https://github.com/RyanNorouzi/synchrobuilder/actions/workflows/ci.yml/badge.svg)](https://github.com/RyanNorouzi/synchrobuilder/actions/workflows/ci.yml)

A [Claude Code](https://code.claude.com) plugin with two halves that ship together:

- **Portability.** Keep a project running on macOS, Windows and Linux while Claude
  writes code: an audit with twelve rules, fixers that show you a diff first, a guard
  that warns Claude in the same turn it introduces a problem, and a setup manifest so a
  teammate on another operating system gets from clone to a passing health check.
- **Multiplayer.** Several developers, each with their own Claude Code on their own
  machine, working in one repository at the same time, each Claude aware of what the
  others are doing. Presence, claims, collision warnings, messages, a task board and
  handoffs travel through the git remote you already have. Nothing is hosted.

## Install

```
npx synchrobuilder@latest install
```

It prints the two Claude Code commands it is about to run, asks, then runs them.
`--uninstall` reverses it. Running it twice changes nothing the second time.

To do it by hand inside Claude Code instead:

```
/plugin marketplace add RyanNorouzi/synchrobuilder
/plugin install synchrobuilder@synchrobuilder
```

Needs Claude Code, Node.js 20 or newer on `PATH`, and git.

## Use it

Inside Claude Code, every command is `/synchrobuilder:<name>`; the bare short form works
too when no built-in owns the name.

```
/synchrobuilder:audit        find OS-specific assumptions in this project
/synchrobuilder:fix          review the diffs and apply the ones you approve
/synchrobuilder:init         write synchrobuilder.json so teammates can set the project up
/synchrobuilder:setup        set this machine up from that manifest, asking before each step
/synchrobuilder:doctor       explain why this machine differs, most likely cause first
/synchrobuilder:ci           generate a workflow that proves it on three operating systems
/synchrobuilder:status       who else on your team is working here
/synchrobuilder:claim        tell teammates you are working on a path
/synchrobuilder:notify       send a teammate a short message
```

Outside Claude Code and in CI, the same commands run as `npx synchrobuilder <name>`.

## What it sends, and what it never does

Only your handle, branch name, a task summary of at most 140 characters, repo-relative
file paths, short messages, structured handoff notes, board entries and claims, all
after secret redaction. Never prompts, transcripts, file contents, diffs, environment
variable values or your email address.

Text that arrives from another machine is treated as untrusted data: sanitized, then
wrapped in a labelled block that tells Claude it is data and not instructions.

Every hook exits cleanly with no output on any internal error, reads only local files,
and never blocks you. If Synchrobuilder is broken, offline or slow, you keep coding.

`SYNCHROBUILDER_NO_WORKER=1` turns the background sync off entirely, leaving the
portability features working.

## Trust

MIT licensed, no runtime dependencies, no build step: what is in the repository is what
runs. Identity is a claim, not authentication, so anyone who can push to your remote can
write team state; Synchrobuilder trusts your repository's access control and nothing
else.

- Source, issues and the full documentation: https://github.com/RyanNorouzi/synchrobuilder
- What is verified and what is not: [docs/VERIFICATION.md](https://github.com/RyanNorouzi/synchrobuilder/blob/main/docs/VERIFICATION.md)
- Privacy statement: [docs/PRIVACY.md](https://github.com/RyanNorouzi/synchrobuilder/blob/main/docs/PRIVACY.md)
