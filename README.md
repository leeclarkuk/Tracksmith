# Tracksmith

Outcome-first Kanban board for agent work on a KiroCrew Gateway (Host).

Describe what you want, choose an engine, review the card in **To do**, then run. The detail drawer leads with the latest result, verification evidence, produced artifacts, and next actions. Chat, Task Runner, and full Host UI stay one click away.

## Prerequisites

- Node.js 20+
- A running KiroCrew Gateway (`kirocrew gateway`) at `http://localhost:5476` (tested against current KiroCrew docs; pin your Host version when validating)

## Quick start

```bash
npm install
npm run build
npm run dev
```

- Web UI: http://localhost:5173 (dev proxy to API)
- API: http://localhost:3000

Production (single port):

```bash
npm run build
PORT=3000 npm run start -w @tracksmith/server
```

Open http://localhost:3000

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | 3000 | Tracksmith server port |
| `GATEWAY_URL` | http://localhost:5476 | KiroCrew Gateway URL |
| `GATEWAY_TOKEN` | (empty) | Token from `kirocrew token --ttl 2h` for remote Host |
| `DATABASE_PATH` | `./data/tracksmith.db` | SQLite database path |

Copy `.env.example` to `.env` and adjust as needed.

## Scheduling

Tracksmith does not implement cron. Schedule work in KiroCrew's Schedule tab:

```bash
kirocrew cron add "your prompt here" --every 86400
```

## Architecture

See [docs/architecture.md](docs/architecture.md) and [docs/gateway-integration.md](docs/gateway-integration.md).

Coding agents: see [AGENTS.md](AGENTS.md) for build commands, review gate (PASS/DENY), and PR rules.

## Licence

Apache 2.0
