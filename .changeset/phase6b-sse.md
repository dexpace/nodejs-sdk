---
'@dexpace/core': minor
---

Add the SSE subsystem: `sseStreamFrom()`, `SseStream`, `typedSseStream()`, the `SseEvent` value and its
operations, and the `MapperOutcome` union. Pull-based with no read-ahead; no reconnection and no last-event-id
continuity, both of which remain the caller's responsibility.
