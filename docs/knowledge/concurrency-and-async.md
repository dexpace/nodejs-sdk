# concurrency-and-async

## Rules
- A CPU-bound synchronous span between awaits blocks the whole event loop and must be pushed off-thread rather than left inline.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/09-concurrency.md:41-44` · high · sha:a947296ee671</sub>
- Own async code must use `async`/`await` rather than a `.then`/`.catch` chain, since `await` reads sequencing top-to-bottom while `.then` scatters it across callbacks and loses the error path.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/09-concurrency.md:46-50` · high · sha:a947296ee671</sub>
- Mixing `async`/`await` and `.then` in one function is disallowed because it forces a reader to hold both a linear and a callback mental model at once.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/09-concurrency.md:50-50` · high · sha:a947296ee671</sub>
- `.then` is legitimate only at interop edges not owned by the caller (a framework callback, adapting a non-async API), and must be converted to `await` as soon as control returns to owned function body.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/09-concurrency.md:51-51` · high · sha:a947296ee671</sub>
- Every promise must be either awaited, returned to a caller that will await it, or explicitly discarded with `void` plus a comment explaining why losing its result and rejection is acceptable.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/09-concurrency.md:55-67` · high · sha:a947296ee671</sub>
- Async work must never be wrapped in an async executor passed to the `Promise` constructor, because a throw inside that executor rejects the unawaited inner promise and swallows the error while the outer promise hangs forever.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/09-concurrency.md:71-80` · high · sha:a947296ee671</sub>
- `new Promise` is sanctioned only to adapt a callback-style API (an event emitter, a Node-style `(err, value)` callback) using a synchronous executor that resolves or rejects from inside the callback.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/09-concurrency.md:76-82` · high · sha:a947296ee671</sub>
- Every long-running async API must accept an options object with `{ signal }: { signal?: AbortSignal }` so cancellation is a declared, first-class part of the contract.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/09-concurrency.md:87-90` · high · sha:a947296ee671</sub>
- Accepting a cancellation signal must be paired with honoring it — flowing the signal down to the actual I/O primitive (`fetch`, a timer, a stream) and checking it between CPU-bound steps.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/09-concurrency.md:92-93` · high · sha:a947296ee671</sub>
- Every external I/O call must carry a deadline via `AbortSignal.timeout(ms)`, since an unbounded wait becomes an unbounded queue of exhausted connections and growing memory.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/09-concurrency.md:96-100` · high · sha:a947296ee671</sub>
- The timeout value passed to `AbortSignal.timeout` should match the user-perceived SLA rather than an overly lenient value, since a lenient deadline hides a real problem.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/09-concurrency.md:100-100` · high · sha:a947296ee671</sub>
- An external call's caller-provided signal must be combined with its deadline signal via `AbortSignal.any([signal, AbortSignal.timeout(ms)])` so whichever fires first wins.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/09-concurrency.md:101-101` · high · sha:a947296ee671</sub>
- Fan-out must be bounded to a fixed concurrency limit via a single project-wide worker-pool helper (`mapWithConcurrency`), with the limit tuned to the dependency's headroom rather than the input size.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/09-concurrency.md:109-112` · high · sha:a947296ee671</sub>
- Naked `Promise.all(items.map(...))` over unbounded input must be rejected in favor of routing through `mapWithConcurrency`.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/09-concurrency.md:136-136` · high · sha:a947296ee671</sub>
- Independent async operations in a loop (`for (const x of xs) { await f(x); }`) must not be serialized; they must be started together and awaited as a batch.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/09-concurrency.md:138-142` · high · sha:a947296ee671</sub>
- Batching independent work uses `mapWithConcurrency` when N is large or unbounded, and `Promise.all`/`Promise.allSettled` when N is small and fixed.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/09-concurrency.md:142-142` · high · sha:a947296ee671</sub>
- A legitimately serial `await`-in-loop (each step depends on the previous result, ordered writes, rate-limited politeness, or a paginated cursor) is correct but must carry a comment stating which reason applies so a reviewer does not "optimize" it into a race.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/09-concurrency.md:143-143` · high · sha:a947296ee671</sub>
- `Promise.all` is correct only when any single failure makes the whole operation meaningless; otherwise it throws away both the successes and the other failures.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/09-concurrency.md:154-157` · high · sha:a947296ee671</sub>
- With `Promise.allSettled`, every rejection must be inspected and never silently discarded by keeping only the fulfilled results; rejections must be collected and, if any exist, surfaced in a single `AggregateError`.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/09-concurrency.md:158-158` · high · sha:a947296ee671</sub>
- State checked before an `await` must be re-validated after every `await` that could have let the world move, or the code must be restructured to single ownership so only one task can mutate the state.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/09-concurrency.md:175-184` · high · sha:a947296ee671</sub>
- A signal accepted at the top of a call chain must be passed through every layer down to the actual I/O primitive; a signal that stops at the first function is decoration.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/09-concurrency.md:189-192` · high · sha:a947296ee671</sub>
- `signal.throwIfAborted()` must be inserted at the top of each loop iteration or before each expensive step so a CPU-bound stretch between awaits observes the abort promptly.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/09-concurrency.md:193-193` · high · sha:a947296ee671</sub>
- When a caller's signal is combined with a local deadline signal, the combined signal must be passed downward so lower layers honor whichever fires first without knowing which.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/09-concurrency.md:193-193` · high · sha:a947296ee671</sub>
- Every queue, buffer, and in-flight map must declare an explicit named bound constant, chosen from the slowest consumer's catch-up time or maximum acceptable memory.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/09-concurrency.md:208-208` · high · sha:a947296ee671</sub>
- A bound on a queue, buffer, or in-flight map must be asserted with `invariant` at the point items are added so a breach crashes at the cause rather than growing silently into an out-of-memory failure.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/09-concurrency.md:208-208` · high · sha:a947296ee671</sub>
- When a bounded queue, buffer, or in-flight map reaches its bound, the only honest responses are backpressure (suspend the producer), shed load (reject), or drop with a counter — never grow.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/09-concurrency.md:209-209` · high · sha:a947296ee671</sub>
- The async transport contract SHOULD be expressed in terms of one canonical, dependency-free async primitive — a future completing with a value or exceptionally — that serves as the interop pivot (SEAM-17).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:18-18` · high · sha:0adae2d6a47f</sub>
- Ecosystem facades (coroutines, reactive streams, event-loop futures, virtual threads) SHOULD be separate adapter modules bridging to and from the canonical async pivot, preserving cancellation and error semantics with per-adapter caveats documented (SEAM-17).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:18-18` · high · sha:0adae2d6a47f</sub>
- The async transport contract is a single-value completion future that yields exactly one Response on success or completes with exactly one failure; on the success path it must deliver a non-null Response, and an implementation with no response must complete via the failure channel rather than deliver a null/absent value.
  <sub>spec · `docs/product-spec/18-asynchronous-runtime-adapter-contract.md:7-7` · high · sha:f1bf00174456</sub>
- Every failure detectable while constructing the async operation (request-adaptation errors, worker-pool rejection) must be delivered through the future's failure channel, never thrown synchronously.
  <sub>spec · `docs/product-spec/18-asynchronous-runtime-adapter-contract.md:8-8` · high · sha:f1bf00174456</sub>
- When surfacing a failure, adapters must unwrap the async framework's wrapper exceptions down to the original cause so typed handlers match the real exception, terminating on the first non-wrapper cause, a null cause, or a detected cycle.
  <sub>spec · `docs/product-spec/18-asynchronous-runtime-adapter-contract.md:28-28` · high · sha:f1bf00174456</sub>
- An async-to-sync blocking bridge must honor thread interruption while awaiting — on interruption it must restore the interrupt flag, cancel the in-flight future, and throw an interrupted-I/O failure, and it must unwrap execution-wrapper exceptions so blocking callers see the original failure — while a future cancelled independently must surface its cancellation as-is, not remapped to I/O.
  <sub>spec · `docs/product-spec/18-asynchronous-runtime-adapter-contract.md:29-29` · high · sha:f1bf00174456</sub>
- An adapter that owns an executor or background threads must expose a close/dispose operation that is idempotent (repeated calls safe, only the first performs shutdown/side-effects), ownership-aware (releases only SDK-owned resources, never a caller-supplied executor/client), and interrupt-safe (honors thread interruption on any blocking shutdown step).
  <sub>spec · `docs/product-spec/18-asynchronous-runtime-adapter-contract.md:33-33` · high · sha:f1bf00174456</sub>
- An adapter that owns an executor should shut it down gracefully on close — stopping new work and waiting for in-flight tasks rather than interrupting them — escalating to forceful shutdown only if the closing thread is itself interrupted, with callers needing eager abort using the interrupt/structured-cancellation path.
  <sub>spec · `docs/product-spec/18-asynchronous-runtime-adapter-contract.md:34-34` · high · sha:f1bf00174456</sub>
- The async transport SPI should provide a no-op default close so lightweight/functional implementations need not implement lifecycle management, while any implementation that owns resources overrides it to follow the idempotent/ownership-aware/interrupt-safe close contract; behavior of executeAsync after close is undefined.
  <sub>spec · `docs/product-spec/18-asynchronous-runtime-adapter-contract.md:35-35` · high · sha:f1bf00174456</sub>
- Components documented as shared/reusable across concurrent requests (pipeline steps, auth handlers, redactors, factories) must be safe for concurrent invocation, with per-call mutable state kept on the call's local state and any shared mutable state synchronized.
  <sub>spec · `docs/product-spec/19-cross-cutting-invariants-and-policies.md:28` · high · sha:d6123be82c9e</sub>
- Hot-path reads of a credential/token cache should be wait-free, refresh should be single-flight so only one concurrent caller fetches an expiring token, and any lock guarding refresh must be scoped to that cache so it never serializes unrelated in-flight requests or the global scheduler.
  <sub>spec · `docs/product-spec/19-cross-cutting-invariants-and-policies.md:29` · high · sha:d6123be82c9e</sub>
- close()/shutdown() must be idempotent (latched so repeats are no-ops) and must not block on interrupt-sensitive waits, using non-blocking shutdown and preserving the ambient interrupt/cancel flag as-is.
  <sub>spec · `docs/product-spec/19-cross-cutting-invariants-and-policies.md:30` · high · sha:d6123be82c9e</sub>
- The SDK must close only resources it created; a caller-supplied (BYO) transport client, executor, or connection pool must not be closed by the SDK, and the caller may keep using it after the SDK component is closed.
  <sub>spec · `docs/product-spec/19-cross-cutting-invariants-and-policies.md:31` · high · sha:d6123be82c9e</sub>
- A pluggable single-implementation seam (the I/O provider or similar SPI) must resolve deterministically, with an explicit install always winning, otherwise auto-discovery from the environment/classpath, and zero or multiple candidates with no explicit selection must fail loudly with an actionable error.
  <sub>spec · `docs/product-spec/19-cross-cutting-invariants-and-policies.md:32` · high · sha:d6123be82c9e</sub>
- Every process/instance-lived map whose key space is influenced by callers or servers must be bounded by a hard cap and must drain back under the cap after each insert using a loop rather than a single pre-insert check-then-evict, so a concurrent insert burst converges to the bound.
  <sub>spec · `docs/product-spec/19-cross-cutting-invariants-and-policies.md:36` · high · sha:d6123be82c9e</sub>

## Constraints
- `@typescript-eslint/no-floating-promises` and `@typescript-eslint/no-misused-promises` enforce that no promise is left floating or misused where a boolean or ignored return is expected.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/09-concurrency.md:69-69` · high · sha:a947296ee671</sub>
- `Promise.all(items.map(fn))` over unbounded `items` is a resource bomb, launching N operations at once regardless of dependency headroom.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/09-concurrency.md:105-108` · high · sha:a947296ee671</sub>
- Any `await` is a yield point where another task can run and change state that was checked before the `await`, making check-then-act across an `await` a real time-of-check-to-time-of-use race even on a single thread.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/09-concurrency.md:170-174` · high · sha:a947296ee671</sub>
- An unbounded queue, retry buffer, batch accumulator, or in-flight request map is a memory leak with a delay: producers outrun consumers and the process dies under load instead of degrading.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/09-concurrency.md:204-207` · high · sha:a947296ee671</sub>

## Conclusions
- The async-runtime concern is deliberately not exposed as a core interface; it is decoupled through a canonical, dependency-free async future type that every ecosystem adapter bridges to and from (SEAM-17).
  <sub>spec · `docs/product-spec/01-product-overview.md:9-9` · high · sha:4f786c44354d</sub>

## Reference
- JavaScript runs on a single thread; what the guide calls concurrency is interleaved I/O, with the runtime resuming each pending `await` as its data arrives and never two lines of code running at once.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/09-concurrency.md:3-3` · high · sha:a947296ee671</sub>
- Every `await` is a suspension point where the function yields, the runtime advances other pending work, and execution resumes only when the awaited promise settles.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/09-concurrency.md:40-40` · high · sha:a947296ee671</sub>
- True parallelism requires workers or processes, which is a runtime concern handled separately from this chapter (e.g. in the typescript-bun workers guide).
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/09-concurrency.md:3-3` · high · sha:a947296ee671</sub>
- The timeout-on-every-external-call rule ports the Python style guide's `asyncio.timeout` discipline (its root rule 9).
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/09-concurrency.md:99-99` · high · sha:a947296ee671</sub>
- The `mapWithConcurrency` worker-pool helper returns `PromiseSettledResult<R>[]` rather than a bare array, so a single failure does not abandon the rest.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/09-concurrency.md:110-134` · high · sha:a947296ee671</sub>
- The reference implementation of the canonical async pivot is java.util.concurrent.CompletableFuture (SEAM-17).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:18-18` · high · sha:0adae2d6a47f</sub>
- The async runtime adapter contract's interchange point is a single canonical completion future that carries exactly one success value or one failure, and every ecosystem facade (coroutines, reactive Mono/Flux, event-loop futures, virtual threads) bridges to and from it.
  <sub>spec · `docs/product-spec/18-asynchronous-runtime-adapter-contract.md:3-3` · high · sha:f1bf00174456</sub>
- A BYO (bring-your-own) resource is a dependency such as a native HTTP client, executor, or connection pool that the caller constructs and hands to the SDK, with the caller owning its lifecycle and the SDK never closing it, in contrast to an SDK-managed resource the SDK created and must release on close.
  <sub>spec · `docs/product-spec/appendix-a-glossary.md:11` · high · sha:f0b3d2058626</sub>
- The canonical completion future is the single dependency-free async value type carrying exactly one success value or one failure, serving as the interop pivot every ecosystem adapter bridges to and from, with the JVM reference being CompletableFuture.
  <sub>spec · `docs/product-spec/appendix-a-glossary.md:13` · high · sha:f0b3d2058626</sub>
- A cold publisher / per-subscription capture is a reusable async object that (re)issues its request and (re)captures logging context on each subscription rather than once at assembly time.
  <sub>spec · `docs/product-spec/appendix-a-glossary.md:15` · high · sha:f0b3d2058626</sub>
- A drain-to-cap bounded map is a concurrent map whose caller/server-influenced keys are capped, drained in a loop back under a hard bound after each insert, converging even under concurrent insert bursts, with an arbitrary eviction victim.
  <sub>spec · `docs/product-spec/appendix-a-glossary.md:29` · high · sha:f0b3d2058626</sub>
- Ownership-aware lifecycle is the close/dispose discipline where the SDK releases only resources it created and never a caller-supplied one, with close being idempotent.
  <sub>spec · `docs/product-spec/appendix-a-glossary.md:37` · high · sha:f0b3d2058626</sub>
- Pooled-thread poisoning is the failure mode where an interrupt aimed at a cancelled call reaches a worker after it has returned to its pool and picked up unrelated work, prevented by an ordering handshake.
  <sub>spec · `docs/product-spec/appendix-a-glossary.md:45` · high · sha:f0b3d2058626</sub>
- The async runtime conformance suite verifies a single-value future is non-null on success or exceptional completion (ASYNC-1) and construction failures surface via the failure channel (ASYNC-2).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:67` · high · sha:0451cc7f3bb4</sub>
- The async runtime conformance suite verifies two-mode cancellation where queued/finished tasks are never interrupted (ASYNC-3), ordered interrupt delivery prevents pooled-thread poisoning under stress (ASYNC-4), an orphaned closeable is closed exactly once on the lost race (ASYNC-5), bidirectional cancellation exists per adapter (ASYNC-6), and per-adapter interrupt-mode-vs-not behavior is documented (ASYNC-7).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:68` · high · sha:0451cc7f3bb4</sub>
- The async runtime conformance suite verifies logging-context propagation across hops (ASYNC-8), save/install/restore including on throw (ASYNC-9), per-subscription/per-submission capture (ASYNC-10), safety with no logging backend present (ASYNC-11), and explicit transfer at the thread-creation boundary on lightweight-thread runtimes (ASYNC-12).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:69` · high · sha:0451cc7f3bb4</sub>
- The async runtime conformance suite verifies wrapper-exception unwrapping is cycle-safe (ASYNC-13) and a blocking bridge honors interruption and unwraps exceptions (ASYNC-14).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:70` · high · sha:0451cc7f3bb4</sub>
- The async runtime conformance suite verifies an owned-executor close is idempotent, ownership-aware, and interrupt-safe (ASYNC-15), graceful executor shutdown occurs on close (ASYNC-16), and a no-op default close exists for functional implementations (ASYNC-17).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:71` · high · sha:0451cc7f3bb4</sub>
- The async runtime conformance suite verifies a non-blocking scheduled delay treats zero as immediate and rejects negative with cancel cancelling the task (ASYNC-18), per-call options are threaded through every bridge (ASYNC-19), a delivered Response is not closed on late cancel (ASYNC-20), reactive SSE has backpressure with the source not closed and single-subscriber (ASYNC-21), and the async transport is concurrent-safe (ASYNC-22).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:72` · high · sha:0451cc7f3bb4</sub>

## Conflicts

## Superseded
