# Hosted hub API sketch (not built in v1)

The transport interface (`plugins/synchrobuilder/lib/transport/interface.mjs`)
has four methods: `probe`, `publish`, `pull`, `status`. A hosted hub would
implement the same four over HTTPS so that hooks, features and commands do
not change. This sketch exists so the v1 design does not paint us into a
corner; nothing here is implemented.

## Why a hub might be wanted later

- Sub-minute presence without polling a git remote.
- Real accounts, so identity stops being a claim.
- Teams whose git host rejects custom refs and branches alike.
- Push delivery of urgent messages when Claude Code offers a supported
  mechanism.

## Endpoints

All requests carry `Authorization: Bearer <team token>` and
`X-Synchrobuilder-Handle` / `X-Synchrobuilder-Device`. Bodies are JSON with
the same schemas as the git files (`docs/PRIVACY.md` table).

| Method and path | Body | Response |
| :-- | :-- | :-- |
| `GET /v1/probe` | none | `{ mode: 'hub', teamId, serverTime }` |
| `PUT /v1/state/<handle>/<device>` | `{ manifest, presence, claims, board, contracts, messages, handoffs }` | `{ etag }` (compare-and-swap with `If-Match`) |
| `GET /v1/state?since=<etag>` | none | `{ writers: [...], etag }` (only changed writers) |
| `GET /v1/status` | none | rate limits, last accepted write per writer |
| `POST /v1/messages` | `{ to, text }` | `{ id }` (optional fast path; also appears in the writer's state) |

## Rules carried over from the git transport

- The client validates every field it receives exactly as it does for git
  refs; the hub is another untrusted writer set.
- The hub stores nothing the git transport does not: no prompts, no
  transcripts, no code, no env values.
- The client keeps working from its last snapshot when the hub is
  unreachable and never blocks Claude.
