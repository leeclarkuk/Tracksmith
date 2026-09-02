# AGENTS.md

Instructions for coding agents working in Tracksmith.

## Project overview

Tracksmith is a standalone outcome-first Kanban board. It connects to a KiroCrew Gateway (Host) as a client. The app owns card persistence and review UX; the Host owns execution, Task Runner, and scheduling.

Monorepo layout:

- `apps/web` — React + Vite Kanban UI
- `apps/server` — Fastify BFF, SQLite, Gateway adapter
- `packages/shared` — types, column state machine, engine classifier
- `docs/architecture.md` — system boundaries and data model
- `docs/gateway-integration.md` — Host API surface

## Commands

```bash
npm install
npm run dev          # server :3000, web :5173 (proxy)
npm run build        # shared → server → web
npm run test         # unit tests (shared + server)
npm run start -w @tracksmith/server   # production, serves web from apps/web/dist
```

Environment: copy `.env.example` to `.env`. Key vars: `GATEWAY_URL`, `GATEWAY_TOKEN`, `DATABASE_PATH`, `PORT`.

## Non-negotiables

- Never call the KiroCrew Gateway from the browser. All Host traffic goes through the Tracksmith BFF.
- Never enable Task Runner or other Host features silently.
- Do not duplicate KiroCrew cron/scheduling UI. Point users to `kirocrew cron add`.
- Running column is not a manual drop target. Cards enter Running only via Run; they leave via settle or reconcile.
- Keep changes scoped. Match existing TypeScript and file layout conventions.

## Verification before PR

1. `npm run build` must pass.
2. `npm run test` must pass.
3. Smoke the API if you touched server routes: `curl http://localhost:3000/api/health`.

## Independent review gate (mandatory)

Before opening or updating a pull request on integration-heavy work, run an **independent Opus review**. This is a hard gate, not optional commentary.

### When to run

Run review before PR when changes touch any of:

- `apps/server/src/gateway/**`
- `apps/server/src/engine/**`
- `apps/server/src/reconcile.ts`
- `apps/server/src/goal-contract.ts`
- `apps/server/src/projector.ts` or `gateway/projector.ts`
- Column state machine in `packages/shared`
- Auth, Host routing, or evidence persistence

Skip for docs-only or purely cosmetic UI tweaks unless they affect run lifecycle.

### Preferred path: Opus review (not bugbot subagent)

Use a **general-purpose Opus agent** (`claude-opus-5-thinking-high`), not the `bugbot` subagent. The bugbot wrapper often omits the required verdict line even when it reports "no bugs".

Paste the prompt below verbatim. The reviewer must produce a normal written review, then end with the verdict line.

### Required reviewer prompt

```
Full Repository Path: /workspace
Diff: branch changes

You are the independent reviewer for Tracksmith. Review the full branch diff against main.

Focus:
- Gateway adapter correctness (REST, WS, deferred settlement, periodic reconcile)
- Column state machine enforcement; Running not a drop target
- Restart and periodic reconciliation; pending run registry lifecycle
- Goal contract bounded loop, auto-retry, acceptance criteria eval
- Evidence persistence and corpus scoping
- Task Runner enablement guard; inline correction disabled while running
- Security: no browser-to-gateway calls; BFF auth defaults

Output format (required):

1. Short summary (2–4 sentences)
2. Findings (if any), ranked by severity with file paths. Omit section if none.
3. Final line ONLY — no text after it:

VERDICT: PASS

or

VERDICT: DENY

Verdict rules:
- PASS: no material issues, or only nits that do not block merge
- DENY: one or more issues that must be fixed before merge
- Do not return findings without a verdict
- Do not use PASS if any high-severity issue remains open
- Do not substitute "no bugs" or "LGTM" for the verdict line
- The last line of your entire response must be exactly VERDICT: PASS or VERDICT: DENY
```

### Fallback: bugbot subagent

Only if a general Opus agent is unavailable, use `bugbot` with the same prompt. If the response lacks `VERDICT: PASS` or `VERDICT: DENY` as the final line, treat the run as **incomplete** and re-run via Opus (not bugbot).

### Agent workflow after review

| Verdict | Agent action |
|---------|--------------|
| **VERDICT: PASS** | Commit fixes (if any nits were addressed), push, open or update PR. |
| **VERDICT: DENY** | Fix every listed issue, re-run the reviewer on the updated branch, repeat until **PASS**. Do not open or mark PR ready while verdict is DENY. |
| No verdict line | Treat as incomplete. Re-run via Opus with the prompt above. Do not merge. |

Record the final **VERDICT: PASS** in the PR description under a **Review** section, including reviewer type (Opus independent / bugbot fallback).

### Architecture review (optional, larger changes)

For structural changes (new subsystems, persistence model changes, new Host integrations), draft or update `docs/architecture.md` first and sanity-check boundaries before implementation. This is not a substitute for the independent reviewer PASS/DENY gate on code.

## PR expectations

- Branch prefix: `cursor/<descriptive-name>-2791` for cloud agent work.
- Draft PR by default.
- PR body must include: summary, test evidence, and **Review** section with final `VERDICT: PASS` from independent reviewer when gate applies.
- Do not edit plan files in `/opt/cursor/artifacts/plans/` unless the user explicitly asks.

## Out of scope unless requested

- KiroCrew App Kit embedded dashboard page
- In-product architecture or reviewer agents
- Cron/scheduling UI
- Multi-user auth
