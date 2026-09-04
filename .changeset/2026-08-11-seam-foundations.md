---
"@dexpace/core": minor
---

Add the seam foundations: the `Transport` contract with its `composeSignal`/`isTimeoutSignal` cancellation helpers and `CancellationError`, the operation-input projection (`OperationDescriptor`, `buildRequest`, `OperationAssemblyError`), and `DexpaceError` as the root of the error taxonomy.

Every existing error leaf keeps its behavior and its message. The taxonomy is two levels: a leaf's own superclass is `DexpaceError` itself, and a family is grouped with an exported type guard rather than an intermediate class.
