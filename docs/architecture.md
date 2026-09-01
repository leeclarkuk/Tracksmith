# Tracksmith Architecture

Tracksmith is a standalone outcome-first Kanban board that orchestrates work on a KiroCrew Gateway (Host). The app owns card persistence and review UX; the Host owns execution, sessions, Task Runner, and scheduling.

## Boundaries

| Concern | Owner |
|---------|-------|
| Card state, evidence, result packets | Tracksmith SQLite |
| Chat, Task Runner, Autopilot execution | KiroCrew Gateway |
| Cron / scheduled runs | KiroCrew Schedule tab only |
| Tool approval, sandbox, governance | KiroCrew Gateway |

Tracksmith never enables Host features silently. It never calls Gateway APIs from the browser; all Host traffic goes through the Tracksmith BFF.

## Components

```
apps/web       React SPA (board, drawer, create field)
apps/server    Fastify BFF, gateway client, projector, reconciler
packages/shared Types, column state machine, validation
```

## Domain model

### OutcomeCard

- `id`, `column`: backlog | todo | running | done | failed
- `prompt`, `title`, `summary`: user input and derived headline
- `engine`, `resolvedEngine`: chat | task_runner | autopilot | auto
- `runRef`: { kind, slotId?, taskId?, sessionKey? }
- `goalContract?`: acceptance criteria, maxAttempts, maxWallClockSeconds, maxTokenBudget
- `resultPacket?`: outcome-first drawer payload
- `evidence[]`: durable artifacts surviving Host run GC
- `audit[]`: timestamps, reconciliation notes, engine resolution
- `failureReason?`, `createdAt`, `updatedAt`, `settledAt`

### Column state machine

Manual transitions (drag or PATCH):

- backlog ↔ todo
- done ↔ failed (human correction only)
- running: not a drop target; entered only via Run, exited only via settle/reconcile

Automatic transitions:

- todo → running: explicit Run
- running → done | failed: Host terminal event or reconciliation

## Event mapping

Gateway WebSocket (`/api/ws`) events consumed by the projector:

| Event | Action |
|-------|--------|
| chat_done | Settle chat/autopilot card; build result packet from slot history |
| chat_error | Settle to failed with error reason |
| task_update | Append evidence; update running state |
| task_complete | Settle task_runner card; pull run record |
| tool_call | Append path/url evidence to audit |

Stall recovery: recovery completion is a normal turn end; audit entry records the recovery notice.

## Reconciliation

On server startup, cards in `running` are checked against Host:

1. Chat: slot exists and has terminal last message → settle; else revert to todo with orphan audit
2. Task Runner: run status paused/running/missing → revert or settle per Host record

## Goal contract loop

Optional bounded loop for Task Runner:

1. Spec includes `## Acceptance criteria` from contract
2. On complete, evaluate checks from step results + evidence
3. Pass → done; retry within limits → todo with nextActions; exhaust → failed

Uses Host Task Runner built-in reviewer; no in-product reviewer agent in v1.

## Dev-process review (see AGENTS.md)

Independent review uses an explicit **PASS** or **DENY** verdict. See [AGENTS.md](../AGENTS.md) for the mandatory gate, prompt template, and agent workflow. Findings alone are not sufficient; the reviewer must end with `VERDICT: PASS` or `VERDICT: DENY`.

Architecture changes should update this document before implementation. Code changes that touch gateway, engine, reconcile, or column logic require **VERDICT: PASS** before PR.

## Failure modes

| Failure | Behaviour |
|---------|-----------|
| Gateway unreachable on create | Local title/summary fallback; card still created in todo |
| Task Runner disabled | Stay in todo; show enable prompt; never flip Host config |
| Orphaned running card | Reconcile on load → todo or done/failed |
| WS disconnect | Reconnect with backoff; reconcile on reconnect |
