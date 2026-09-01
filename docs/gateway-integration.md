# Gateway Integration

Tracksmith connects to a KiroCrew Gateway as an external client. Pin tested Host version in README when validating.

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| GATEWAY_URL | http://localhost:5476 | Gateway base URL |
| GATEWAY_TOKEN | (empty) | Auth token from `kirocrew token --ttl …` |
| DATABASE_PATH | ./data/tracksmith.db | SQLite path |

Loopback may work tokenless; remote Host requires token on every REST and WebSocket call.

## REST endpoints used

### Status and capabilities

- `GET /api/status` — health, feature detection (Task Runner availability)

### Chat slots

- `POST /api/slots` — create slot (name, agent optional)
- `GET /api/slots` — list slots
- `GET /api/slots/{id}/history?limit=50` — message history for result projection
- `POST /api/slots/{id}/message` — send message (initial run and inline correction)

### Task Runner

- `POST /api/taskrunner` — start run from inline spec markdown
- `GET /api/taskrunner` — list runs
- `GET /api/taskrunner/{id}` — run detail with step results
- `POST /api/taskrunner/{id}/pause` — pause run
- `POST /api/taskrunner/{id}/to-chat` — open result in chat for follow-up

### Agent dispatch (title derivation)

- Lightweight one-shot via slot create + message, or dispatch endpoint when available

## WebSocket

- Connect: `ws://{host}/api/ws` (with token query param when required)
- Events: `chat_done`, `chat_error`, `chat_chunk`, `task_update`, `task_complete`, `tool_call`, `notification`

## Dashboard deep links

- Chat slot: `{GATEWAY_URL}/?slot={slotId}`
- Tasks panel: `{GATEWAY_URL}/tasks` (task detail when taskId known)

## Auth headers

When token set:

```
Authorization: Bearer {GATEWAY_TOKEN}
```

WebSocket: `?token={GATEWAY_TOKEN}` on connect URL.
