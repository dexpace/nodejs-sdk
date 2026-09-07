# cancellation-and-timeouts

## Rules
- Blocking transports SHOULD honor cooperative cancellation during blocking I/O so an interrupted parked blocking send unwinds (SEAM-13).
  <sub>spec · `docs/product-spec/02-architectural-principles.md:26-26` · high · sha:8014d2ec2c9d</sub>
- Async transports SHOULD treat cancelling the returned future as a best-effort abort of the in-flight exchange, firing the transport's cancel hook (SEAM-13).
  <sub>spec · `docs/product-spec/02-architectural-principles.md:26-26` · high · sha:8014d2ec2c9d</sub>
- Cancellation is terminal and non-retryable and MUST be distinguished from a retryable timeout out-of-band, never by matching an error message.
  <sub>spec · `docs/product-spec/02-architectural-principles.md:27-27` · high · sha:8014d2ec2c9d</sub>
- When an async operation is backed by a blocking task on a worker thread, cancellation must distinguish cancel-with-interrupt (interrupts the worker running the in-flight task) from cancel-without-interrupt (cancels the logical operation without interrupting), and a task still queued or already finished must not be interrupted.
  <sub>spec · `docs/product-spec/18-asynchronous-runtime-adapter-contract.md:12-12` · high · sha:f1bf00174456</sub>
- Interrupt delivery must be ordered so a stale interrupt cannot poison a pooled thread: the cancel path publishes an "interrupt in flight" marker before reading the worker, the worker's return-to-pool step blocks until that marker clears, and after the task ends the worker clears its own interrupt flag before reuse; a worker already returned to its pool must not receive an interrupt aimed at a completed call.
  <sub>spec · `docs/product-spec/18-asynchronous-runtime-adapter-contract.md:13-13` · high · sha:f1bf00174456</sub>
- If a worker computes a closeable result but the future was already terminated so the value can never be delivered, the adapter must close that orphaned value exactly once, with whoever loses the produce/terminate race performing the close.
  <sub>spec · `docs/product-spec/18-asynchronous-runtime-adapter-contract.md:14-14` · high · sha:f1bf00174456</sub>
- Cancellation must propagate bidirectionally across each adapter: cancelling the runtime-native primitive (subscription, promise, coroutine/job) must cancel the underlying canonical future, and cancelling the canonical future must reach the runtime primitive / native transport call.
  <sub>spec · `docs/product-spec/18-asynchronous-runtime-adapter-contract.md:15-15` · high · sha:f1bf00174456</sub>
- A thread/task cancellation must be surfaced as a distinct, terminal, non-retryable signal kept separate from a timeout, propagating cancellation without losing the ambient cancellation flag and never allowing a cancelled operation to be automatically retried.
  <sub>spec · `docs/product-spec/19-cross-cutting-invariants-and-policies.md:9` · high · sha:d6123be82c9e</sub>
- A read/response/connect timeout must be classified as a retryable transport failure and must not set the cancellation flag, with timeout and cancellation distinguished by ambient cancellation state rather than a message string, even when both use the same exception type and the timeout type is a subtype of the cancellation type.
  <sub>spec · `docs/product-spec/19-cross-cutting-invariants-and-policies.md:10` · high · sha:d6123be82c9e</sub>
- Inter-attempt retry waits must be promptly cancellable, aborting near-immediately on cancellation, surfacing the cancellation signal rather than a spurious timeout, and cancelling any timer/future the wait armed.
  <sub>spec · `docs/product-spec/19-cross-cutting-invariants-and-policies.md:11` · high · sha:d6123be82c9e</sub>
- The transport's send() implementation must, after the underlying fetch resolves, check whether its own signal already fired before delivering the response through its returned Promise, and if so must invoke response.body?.cancel() itself rather than resolving, in order to satisfy SEAM-30's requirement to close a response the caller will never receive.
  <sub>design · `docs/sdk-design-nodejs/03-seam-by-seam-idiomatic-mapping.md:87-91` · high · sha:b691aee1e452</sub>
- The fire-and-forget cleanup path that closes an undelivered response must itself be awaited or given a .catch(() => {}) internally, because an unhandled rejection on that path crashes the process under Node's default unhandledRejection policy.
  <sub>design · `docs/sdk-design-nodejs/03-seam-by-seam-idiomatic-mapping.md:91-93` · high · sha:b691aee1e452</sub>

## Constraints
- A Promise has no public cancel() method; unlike CompletableFuture.cancel(), which can synchronously flip a future's internal state, Promise cancellation is purely cooperative and the producing function must itself observe signal.aborted and reject its own Promise.
  <sub>design · `docs/sdk-design-nodejs/03-seam-by-seam-idiomatic-mapping.md:83-87` · high · sha:b691aee1e452</sub>

## Conclusions
- Each adapter chooses whether its native cancellation maps to interrupt-mode or non-interrupt-mode, and that choice determines whether an in-flight blocking call is aborted; a port should preserve and document, per adapter, whether cancelling through a runtime aborts a blocking transport or lets it run to completion.
  <sub>spec · `docs/product-spec/18-asynchronous-runtime-adapter-contract.md:16-16` · high · sha:f1bf00174456</sub>
- Cancellation across SEAM-13, SEAM-30, RETRY-23/24, and XCUT-1/2 is expressed end-to-end with AbortController/AbortSignal, the platform's own purpose-built cancellation vehicle already used by native fetch, undici, and Node timer APIs.
  <sub>design · `docs/sdk-design-nodejs/03-seam-by-seam-idiomatic-mapping.md:72-74` · high · sha:b691aee1e452</sub>

## Reference
- signal.reason lets an aborted call carry a typed cause (a TimeoutError vs. a caller-initiated CancellationError), satisfying XCUT-2's requirement that timeout and cancellation be told apart by ambient state rather than by matching a message string, by checking signal.reason's concrete class.
  <sub>design · `docs/sdk-design-nodejs/03-seam-by-seam-idiomatic-mapping.md:74-78` · high · sha:b691aee1e452</sub>
- Per-call timeouts are expressed as AbortSignals derived via AbortSignal.timeout(ms), composed with a caller signal via AbortSignal.any([...]), satisfying TRANSPORT-5's per-call-timeout-without-touching-the-shared-client requirement because a fresh derived signal is inherently scoped to one call.
  <sub>design · `docs/sdk-design-nodejs/03-seam-by-seam-idiomatic-mapping.md:78-81` · high · sha:b691aee1e452</sub>

## Conflicts

## Superseded
