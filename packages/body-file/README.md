# @dexpace/body-file

A file-backed request `Body` for the dexpace SDK. Zero dependencies beyond a `@dexpace/core` peer —
`node:fs` is a runtime API, not an npm package, which is exactly why this lives here and not in
`@dexpace/core` (whose zero-`node:`-import invariant is hard).

```sh
bun add @dexpace/body-file @dexpace/core
```

```typescript
import {Request} from '@dexpace/core';
import {fileBody} from '@dexpace/body-file';

// Validated at construction, not at send time (HTTP-40, BODY-11).
const body = fileBody('./upload.bin', {start: 1024, count: 4096});

const request = Request.newBuilder()
  .method('POST')
  .url('https://example.com/v1/uploads')
  .body(body)
  .build();
```

## Fail-fast construction

`fileBody()` stats the path immediately and rejects all four ways it can be wrong, none of which
follows from another: the path must exist and be a **regular** file; `start >= 0`; `start <= size`;
`count >= 0`; and `start + count <= size`. The `start <= size` check earns its place — `count`
defaults to `size - start`, which goes *negative* for a start past end-of-file and then satisfies
the sum check, silently producing a zero-byte upload instead of an error.

## Behavior worth knowing

- `replayable` is always `true`, and `writeTo()` opens a **fresh** handle per call, so a retry
  re-sends the same bytes (`HTTP-40`).
- `writeTo()` does not close the sink it was handed — closing belongs to whoever created it
  (`BODY-8`) — and aborts it on failure so a consumer sees the error rather than a silently
  truncated stream. The read handle is destroyed on every exit path, so a failed send strands no
  file descriptor.
- A short read raises rather than reporting success (`BODY-13`).
- Transports recognize the result **structurally**, through `body.kind === 'file'`, never an
  `instanceof` against this package: `@dexpace/transport-undici` dispatches straight off the file,
  and neither transport depends on this package.
