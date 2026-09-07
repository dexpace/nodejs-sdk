---
"@dexpace/core": patch
---

A cancellation observed inside core now surfaces as `CancellationError`, the same type the transport
layer already produced for the identical abort (XCUT-1, `docs/work/mvp/2026-09-04-open-items-dissolution.md` N1).

The retry engine's `RETRY-32` exit handed back `config.signal.reason` verbatim, and the bearer
cache's `raceAbort` rejected with it, so a caller writing
`catch (e) { if (e instanceof CancellationError) … }` handled a cancelled transport dispatch and
silently missed a cancelled backoff or a cancelled token fetch — those arrived as a bare
`DOMException` named `AbortError`. Both now map through the same shape, keeping the caller's own
abort reason as the error's `cause`.

`XCUT-3` is why the mapping is not unconditional: a signal aborted by `AbortSignal.timeout()`
surfaces `TransportFailureError`, so a timeout stays distinguishable from a cancellation.

`Clock.sleep` is deliberately unchanged — `CFG-17` requires it to reject with the caller's reason
exactly as given, and the retry loop absorbs that rejection rather than surfacing it.
