---
"@dexpace/core": minor
---

Add the seam foundations: the `Transport` contract with its `composeSignal`/`isTimeoutSignal` cancellation helpers and `CancellationError`, the operation-input projection (`OperationDescriptor`, `buildRequest`, `OperationAssemblyError`), and `DexpaceError` as the new root of the error taxonomy above `DomainModelError`.

`DomainModelError` now extends `DexpaceError` instead of `Error`. This is additive — every existing leaf keeps its parent, its behavior, and its `instanceof DomainModelError` narrowing.
