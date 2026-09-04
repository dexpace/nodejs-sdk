---
"@dexpace/core": patch
---

`toHttpError` no longer lets a failing `close()` replace the `HttpStatusError` it was about to
build. The drain ended in a bare `finally { await response.close() }`; `Response.close()` memoizes
its release promise, so a response whose close had already failed handed the same rejection back
from inside that `finally`, and it replaced the result. A 5xx then surfaced as the raw close error
with `error instanceof HttpStatusError` false — making the `@throws HttpStatusError on 4xx/5xx` tag
on `decodeSuccessResponse`, `statusMappingStep` and the retry engine untrue.

Release now goes through `releaseQuietly`/`withReleaseFailure`, the same pair every other subsystem
uses (RECOV-12):

- a **read** failure stays primary, with the release failure suppressed under it;
- a **successful** read returns the `HttpStatusError` even when the release failed, carrying that
  failure as the error's `cause` rather than dropping it.

Fixing it at `toHttpError` covers all four callers at once. Recorded at `docs/open-items.md` H14 (of
which `P1` is the same defect under a second letter).
