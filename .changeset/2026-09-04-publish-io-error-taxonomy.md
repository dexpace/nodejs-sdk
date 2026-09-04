---
"@dexpace/core": minor
---

Publish the four flat I/O error leaves, `isIoError`, and the `SuppressedErrorLike` type. Additive —
no class changed, no hierarchy moved, and nothing was renamed.

Newly on the barrel: `SourceContractViolationError`, `ClosedResourceError`, `AllocationLimitError`,
`isIoError`, and `SuppressedErrorLike` (a type, not the class). `IoError`, `EndOfStreamError` and
`TransportFailureError` were already there.

A caller receives these today and had no name to catch them by. `decodeResponse`'s guard is a single
`e instanceof DexpaceError` pass-through — anything already in this SDK's typed tree is never
re-typed — so a body stream that fails with a `ClosedResourceError` or an `AllocationLimitError`
delivers exactly that class, identity preserved, to a caller who could not `import` it. `isIoError`
is the category catch a deliberately flat error tree cannot offer through `instanceof`:

```ts
import {isIoError} from '@dexpace/core';

try {
  await decodeResponse(response, deserializer, {schema});
} catch (error) {
  if (isIoError(error)) retry();
}
```

`SuppressedErrorLike` is exported as a type because `instanceof SuppressedError` is **not** a valid
test on this package's declared `engines.node >=20.3` floor, where the global is absent. A caller
narrowing a decode failure whose release also failed needs the structural shape — `name` is
`'SuppressedError'`, `.error` is the primary throwable, `.suppressed` rides along — not a class.

This completes the taxonomy the previous release started: `DomainModelError` was flattened and
replaced with a `@public isDomainModelError` guard, making "two levels, plus an exported guard per
family" the settled shape. `isIoError` is that guard for `io/`, and `isBodyError` was already public.

See `docs/work/mvp/2026-09-04-open-items-dissolution.md` H8.
