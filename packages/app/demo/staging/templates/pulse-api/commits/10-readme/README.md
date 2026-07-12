# Pulse

A lightweight telemetry API: services fire events at it, Pulse keeps a
ring-buffered history and live gauges in memory. No database, no queue —
it is deliberately the simplest thing that answers "what just happened?"

## Getting started

```bash
npm install
npm run dev
```

The server comes up on `http://localhost:4600` (override with `PORT`).

```bash
npm test        # vitest, runs against ephemeral in-process servers
```

## API

| Endpoint         | Method | What it does                                             |
| ---------------- | ------ | -------------------------------------------------------- |
| `/health`        | GET    | Liveness snapshot: status, uptime, start time            |
| `/events`        | POST   | Ingest one event into the ring buffer (capacity 500)     |
| `/events/recent` | GET    | Newest-first slice of the buffer (`?limit=`, default 50) |
| `/metrics`       | GET    | Current gauge values plus buffer occupancy               |

### Ingesting events

```bash
curl -X POST http://localhost:4600/events \
  -H "content-type: application/json" \
  -d '{ "name": "deploy.finished", "tags": { "env": "staging" } }'
```

Events with a numeric `value` double as gauge updates — the latest value
wins and shows up under `/metrics`:

```bash
curl -X POST http://localhost:4600/events \
  -H "content-type: application/json" \
  -d '{ "name": "cpu.load", "value": 0.42 }'
```

## Layout

```
src/
  server.js         HTTP server factory + router
  http.js           JSON helpers and request validation errors
  store.js          EventStore: ring buffer + gauges
  routes/           one small handler module per resource
test/               vitest suites against real server instances
```

## Notes

- Everything is in-memory by design; restarting the process clears history.
- The store is injected into `createApp()`, so tests run isolated instances
  on ephemeral ports with no shared state.
