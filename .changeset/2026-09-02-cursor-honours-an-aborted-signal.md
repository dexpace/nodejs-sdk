---
"@dexpace/core": patch
---

The pipeline cursor now checks the caller's `AbortSignal` at every step boundary, so a cancelled call
stops walking instead of running every installed step and only failing at the transport hop.

`Cursor` accepted the signal, threaded it to the terminal transport, and never looked at it in
between — against `concurrency-and-async.md`'s "check the signal at the top of each loop iteration or
before each expensive step". Each pillar guarded its *own* loop (`RETRY-32`, redirect's per-hop
check), but the walk itself was unguarded, so an already-aborted call could still do real work on the
way down — the auth step's bearer-token refresh being the concrete case.

**Consumer-observable:** a call whose signal is already aborted now rejects before any step runs, so
no wire send happens and no response is produced. It previously dispatched and, on the redirect path,
handed the first hop back open. An abort raised *during* a hop is unchanged: the redirect step's own
guard runs before it forks again, so the in-flight response is still returned unclosed (`PIPE-40`).

The abort is mapped through the same helper `docs/work/mvp/2026-09-04-open-items-dissolution.md` N1 added, so it surfaces as
`CancellationError` with the caller's own reason as `cause` — never a bare `DOMException` — and a
timeout-aborted signal still surfaces `TransportFailureError`, keeping `XCUT-3`'s distinction.

Closes `docs/work/mvp/2026-09-04-open-items-dissolution.md` V15 and Section T's `F9`.
