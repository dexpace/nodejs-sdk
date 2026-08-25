---
"@dexpace/core": minor
---

Phase 3 review pass 2. Five defects, each in the same class as one pass 1 already fixed — the earlier fixes
were correct but did not reach every site the same reasoning applies to.

Correctness:

- `Response.bytes()`, `Response.text()` and `toHttpError()` now acquire the body reader **inside** the try, so
  the response is closed even when the read cannot start. `getReader()` itself throws a `TypeError` when an
  external consumer already holds the lock — which `BODY-15` explicitly forbids assuming away, and which
  `Response.close()` was already hardened for — so the one failure `BODY-16`'s close guarantee most needs to
  cover was the one that skipped the close entirely and held the connection open.
- `MultipartBody.writeTo` verifies the bytes it writes against its own declared `contentLength`. The shared
  framing routine keeps the framing consistent but takes each part's own `contentLength` on trust, and
  `MultipartPart.body` is the public `Body` interface — so a caller implementation reporting one length and
  writing another desynchronized the value a transport stamps into `Content-Length` from what reaches the
  socket. An overrunning chunk is now refused before it is written, and a short total raises inside the writer
  scope so the sink is aborted rather than cleanly closed (HTTP-51, same shape as `StreamBody`'s HTTP-39 check).
- `withRequestLogging` closes the primary sink when a delegate resolves without closing the adapter. It is the
  only place that takes a writer on behalf of someone else's `Body`, so a delegate that ignored `writeTo`'s
  close-the-sink contract stranded the caller's sink open and locked with nothing thrown to notice it by.
- A foreign primitive source that over-reports its transferred count now raises `SourceContractViolationError`.
  It previously surfaced as `EndOfStreamError: delivered 2 of 99 bytes` — a foreign source's broken accounting
  reported as an exhausted stream, which is the exact confusion `IO-17` forbids and which the under-report
  direction was already guarded against (IO-17).

Documentation:

- `multipartBody`'s `boundary` parameter and `MultipartBodyBuilder.boundary` now state the obligation a
  caller-supplied delimiter carries. RFC 2046 requires the sender to pick a boundary that appears in no part,
  and that half cannot be checked here — a `StreamBody` part's bytes do not exist until the write, and a partial
  scan would read as a complete guarantee. The generated default (32 random characters from Web Crypto) is the
  mitigation, and is why it is the default.

Tooling:

- New blocking gate `verify:consumer-types`: compiles a throwaway consumer against the built `.d.ts` using the
  `lib` and `target` read from `tsconfig.base.json`, with `types: []`. This is the gate whose absence let pass
  1's `Symbol.asyncDispose` defect ship — `typecheck` passes on dev-only ambient globals, `build` emits
  regardless, `api` only compares a report, `lint:publish` checks resolution and export shape rather than
  whether declarations resolve, and `verify:dual-consumption` runs `node`, not `tsc`. Verified to fail on the
  reintroduced defect and pass once reverted.
