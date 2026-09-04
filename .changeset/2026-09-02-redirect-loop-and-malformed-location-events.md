---
"@dexpace/core": patch
---

`redirectStep()` now emits the last two of `REDIR-28`'s four structured events:
`http.redirect.loopDetected` and `http.redirect.malformedLocation`. Phase 7b shipped the hop,
rejection and permitted-downgrade events; these two were blocked because `decide()`'s
`'return-current'` outcome was a bare `{kind}` that could not tell loop detection from a hop cap
from ordinary termination.

`Decision`'s `'return-current'` variant now carries a `reason` — `'not-a-redirect'`,
`'not-eligible'`, `'malformed-location'`, `'loop-detected'` or `'hop-cap'`. `decide()` and
`Decision` are `@internal` and appear in no API report, so no published surface changes.

The malformed-Location event logs the header **raw**, unredacted. That is `REDIR-28`'s own carve-out:
the value failed to parse into a URL, so there is nothing for the redactor to key off. A deployment
whose upstreams may send credential-bearing malformed `Location` values should account for it.

Closes `docs/work/mvp/2026-09-04-open-items-dissolution.md` G3, and the "Redirect's loop-detected and malformed-Location events"
row in Section D.
