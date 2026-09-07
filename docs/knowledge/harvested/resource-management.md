# resource-management

## Rules
- Bind every locally-scoped disposable resource with `using`/`await using` rather than closing it by hand.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/13-resource-management.md:44-50` · high · sha:2a89374d8fe2</sub>
- Use `await using` for resources whose teardown is asynchronous (connections, async iterators, server handles); use plain `using` only when disposal is synchronous.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/13-resource-management.md:49-49` · high · sha:2a89374d8fe2</sub>
- A class that owns a resource requiring release must implement `Symbol.dispose`/`Symbol.asyncDispose` rather than exposing a public `close()` method as the primary teardown interface.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/13-resource-management.md:54-58` · high · sha:2a89374d8fe2</sub>
- If a legacy `close()` method must remain for an existing caller, make `[Symbol.dispose]` delegate to it so there is a single teardown path.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/13-resource-management.md:58-58` · high · sha:2a89374d8fe2</sub>
- Make disposal idempotent by guarding with a `#disposed` flag and returning early on a second dispose call.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/13-resource-management.md:59-59` · high · sha:2a89374d8fe2</sub>
- After disposal, other methods on a disposable resource must fail loudly via an `invariant` (e.g., `invariant(!this.#disposed, 'use after dispose')`) rather than silently operating on a closed handle.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/13-resource-management.md:60-60` · high · sha:2a89374d8fe2</sub>
- Use `DisposableStack`/`AsyncDisposableStack` for composite teardown of two or more resources instead of nesting `try/finally` blocks.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/13-resource-management.md:82-86` · high · sha:2a89374d8fe2</sub>
- A constructor that acquires multiple resources should build them inside a `using` stack and commit on the last line with `stack.move()`, so a throw before the move unwinds everything acquired so far.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/13-resource-management.md:87-87` · high · sha:2a89374d8fe2</sub>
- Use a single `AbortController` as the lifecycle handle for a unit of work, threading its `signal` down and never letting a child create its own controller for work the parent owns.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/13-resource-management.md:103-107` · high · sha:2a89374d8fe2</sub>
- Compose multiple abort conditions with `AbortSignal.any([...])` (e.g., a per-call timeout and a parent's shutdown signal) rather than juggling several controllers.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/13-resource-management.md:108-108` · high · sha:2a89374d8fe2</sub>
- Register event listeners with `addEventListener(type, fn, { signal })` instead of manually pairing a call with `removeEventListener`, so the listener is removed automatically when the signal aborts.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/13-resource-management.md:109-109` · high · sha:2a89374d8fe2</sub>
- Every `setTimeout`/`setInterval` must have an owner and a clear cleanup path: tied to a signal's abort listener, registered via `stack.defer(() => clearTimeout(id))` in the owning stack, or returned as a disposer the caller is obliged to run.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/13-resource-management.md:113-117` · high · sha:2a89374d8fe2</sub>
- Prefer a managed, `Disposable`-returning timer wrapper (e.g., an `interval(ms, fn, signal)` helper that clears on dispose) over raw timers in long-lived code.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/13-resource-management.md:118-118` · high · sha:2a89374d8fe2</sub>
- Bound every cache, pool, and queue that grows with input, with the bound named as an explicit design parameter rather than assumed to be "enough."
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/13-resource-management.md:123-129` · high · sha:2a89374d8fe2</sub>
- Size caches as LRU (or LFU) with a maximum entry count paired with a TTL where applicable, since TTL-based expiry is a simple clock read while event-based invalidation is a distributed-systems problem to avoid inside a cache.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/13-resource-management.md:127-127` · high · sha:2a89374d8fe2</sub>
- Never cache errors long-term; cache negative results briefly or not at all.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/13-resource-management.md:127-127` · high · sha:2a89374d8fe2</sub>
- Connection and worker pools must declare an explicit `max` chosen from downstream capacity and memory, with checkout bounded by a timeout so a saturated pool fails fast instead of queueing forever.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/13-resource-management.md:128-128` · high · sha:2a89374d8fe2</sub>
- Queues that decouple producers from consumers must declare a `maxSize` and a defined policy at the bound — reject, drop-oldest, or backpressure.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/13-resource-management.md:129-129` · high · sha:2a89374d8fe2</sub>
- Release resources in reverse acquisition order, since the later-acquired resource that depends on the earlier one must be disposed first.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/13-resource-management.md:138-141` · high · sha:2a89374d8fe2</sub>
- When hand-writing a composite unwind instead of using a `DisposableStack`, write it bottom-up and comment the dependency between resources.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/13-resource-management.md:143-143` · high · sha:2a89374d8fe2</sub>
- Default to reverse-order release even for independent resources, since it costs nothing and removes the need to prove independence on every edit.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/13-resource-management.md:144-144` · high · sha:2a89374d8fe2</sub>
- Never rely on `FinalizationRegistry` as a resource-cleanup strategy, since its callbacks may run late, may coalesce, and are not guaranteed to run at all even at process exit.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/13-resource-management.md:152-152` · high · sha:2a89374d8fe2</sub>
- Close resources explicitly every time, through `using`/`await using` or a `DisposableStack`, rather than depending on the garbage collector.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/13-resource-management.md:153-153` · high · sha:2a89374d8fe2</sub>
- Tests must assert that a resource's disposer ran exactly once, on both the happy path and the throwing path, by spying on the disposer.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/13-resource-management.md:159-161` · high · sha:2a89374d8fe2</sub>
- Close any resource a test opens in that same test's `afterEach`, so a leak in the subject cannot mask itself by riding the suite's process exit.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/13-resource-management.md:162-162` · high · sha:2a89374d8fe2</sub>
- Assert the order of release for composite teardown by recording disposals into an array and checking it equals the reverse of the acquisition sequence.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/13-resource-management.md:163-163` · high · sha:2a89374d8fe2</sub>

## Constraints
- Using disposable types (`using`/`await using`, `Disposable`/`AsyncDisposable`) requires an explicit `"lib": ["es2023", "esnext.disposable"]` entry in `tsconfig.json`.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/13-resource-management.md:52-52` · high · sha:2a89374d8fe2</sub>
- On Node.js, an unref'd timer (`timer.unref()`) still must be explicitly cleared to release its held closure, because unref only affects event-loop liveness, not the memory/handle leak.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/13-resource-management.md:119-119` · high · sha:2a89374d8fe2</sub>
- The garbage collector reclaims memory only and does not track or hurry the release of OS handles such as file descriptors, sockets, or locks.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/13-resource-management.md:148-151` · high · sha:2a89374d8fe2</sub>
- `bun test` exposes no timer-count introspection, so timer ownership must be made testable by design — setup returns a disposer, the test runs disposal, waits a tick, then asserts the spied callback count did not move.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/13-resource-management.md:161-161` · high · sha:2a89374d8fe2</sub>

## Conclusions

## Reference
- Disposal for a `using`-bound resource runs in reverse declaration order at end of scope, regardless of whether the scope exits by return, throw, or break.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/13-resource-management.md:47-47` · high · sha:2a89374d8fe2</sub>
- If a resource's disposal throws while the body already threw, the runtime wraps both errors in a `SuppressedError`, treating the disposal failure as primary and preserving the original error as `.suppressed`.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/13-resource-management.md:50-50` · high · sha:2a89374d8fe2</sub>
- `stack.use(resource)` registers a disposable, `stack.defer(() => ...)` registers a teardown callback, and `stack.adopt(value, dispose)` registers a value with an external disposer.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/13-resource-management.md:86-86` · high · sha:2a89374d8fe2</sub>
- Disposing a `DisposableStack` runs every registration in reverse order, and one registration throwing does not skip disposal of the rest.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/13-resource-management.md:86-86` · high · sha:2a89374d8fe2</sub>
- `stack.move()` transfers ownership of all registered resources to a fresh stack and disarms the original.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/13-resource-management.md:87-87` · high · sha:2a89374d8fe2</sub>
- `WeakRef`/`WeakMap` are legitimate for non-pinning caches and back-references, but collection of the referent runs no teardown, so they are not a cleanup mechanism.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/13-resource-management.md:153-153` · high · sha:2a89374d8fe2</sub>

## Conflicts

## Superseded
