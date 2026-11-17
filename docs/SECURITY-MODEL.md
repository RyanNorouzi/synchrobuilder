# Security model

## Assets and boundaries

- The developer's machine, repository and Claude Code session are trusted.
- The git remote is trusted to enforce its own access control and nothing
  more: whoever can push can write any Synchrobuilder state, under any
  handle.
- Everything that arrives from the remote is untrusted input, even from
  teammates, because a teammate's machine or session may be compromised.

## Threats and controls

| Threat | Control |
| :-- | :-- |
| A teammate's message instructs Claude to do something | Wrapped in a labelled data block with a per-injection nonce and line prefixes; sanitized (controls, invisible characters, markup that imitates system or tool messages, role labels, code fences, URLs); Claude is told it is data, not instructions (`adr/ADR-005-teammate-message-security.md`) |
| A teammate's data is malformed or hostile (deep JSON, huge blobs, traversal paths, reserved names) | Validate-or-reject on every identifier; size and count caps at fetch time; only regular blobs of allowed names are read; nothing is ever checked out into a worktree (`adr/ADR-001-transport.md` section 2) |
| A hostile ref tries to block everyone's sync | One ref per writer; writers never read remote state before writing; a poisoned ref affects only its own entry, which is dropped (`adr/ADR-001-transport.md`) |
| Impersonation by someone with push access | Not prevented in v1; the committer email is compared with the team file and mismatches are labelled and excluded from prompts. Signed state commits are a possible v2 hardening |
| Secrets in shared text | Redaction on write and on read; env var values are never read into state |
| A hook stalls or crashes and blocks the developer | Every hook exits 0 with no output on any error and has an internal watchdog. All but one read local files only; the pre-edit hook may push one lease ref, under its own deadline, and lets the edit through if that fails (`adr/ADR-007-leases.md`) |
| Someone with push access holds a file by writing a lease, to stop others editing it | A lease is honoured only until its expiry, at most 24 hours ahead and normally 10 minutes, so it must be renewed to persist; a holder whose handle is not in `team.json` is reported and never enforced; `leases.mode = warn` removes enforcement; a person can run `lease take <path> --force` |
| A hostile lease document | Validated on read, never repaired: handle, device, seat and timestamps must match their rules or the lease counts as unreadable and is replaceable; the path shown to Claude is the local one, never the remote's |
| Claude Code injects hook output that a third-party hook could spoof | Out of our control; the wrapper's nonce and prefixes make our block hard to forge, and the human sees a one-line `systemMessage` for messages |
| Terminal escape injection via the status line or system messages | Human-visible surfaces render validated identifiers in fixed templates only |
| Supply chain | No runtime dependencies, no build step, no lockfile in the plugin (so Claude Code's automatic install is skipped); plain ESM you can read |
| Machine changes by `setup` | Full plan shown first, per-step consent, exact versions, no silent elevation |

## Reporting

See `SECURITY.md` at the repository root.
