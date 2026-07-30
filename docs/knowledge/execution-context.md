# execution-context

## Rules
- The execution context model MUST provide three context flavors forming a one-way promotion chain mirroring the call lifecycle -- a dispatch stage before any request, a request stage with an outgoing request assembled, and an exchange stage after a response arrives -- with promotion advancing dispatch to request to exchange only and the exchange stage terminal.
  <sub>spec · `docs/product-spec/07-execution-context-model.md:7` · high · sha:5a9eacfb1c53</sub>
- Each promotion in the execution context chain MUST be additive and non-mutating, producing a new instance without modifying the source, carrying forward the same instrumentation bundle and call key, and adding exactly one new artifact (the request when promoting dispatch to request, the response when promoting request to exchange).
  <sub>spec · `docs/product-spec/07-execution-context-model.md:8` · high · sha:5a9eacfb1c53</sub>
- The entire context promotion chain MUST share one call key -- a promotion carries the source's call key forward verbatim so all three flavors register under the identical store slot and successive promotions overwrite one entry.
  <sub>spec · `docs/product-spec/07-execution-context-model.md:9` · high · sha:5a9eacfb1c53</sub>
- A directly-constructed (off-chain) context without an explicit key MUST receive a fresh call-unique key using the same uniqueness guarantee as promoted contexts, and default construction MUST mint globally distinct keys across the whole process and all three flavors.
  <sub>spec · `docs/product-spec/07-execution-context-model.md:14` · high · sha:5a9eacfb1c53</sub>
- Because the call key participates in value-equality, two default-constructed contexts with otherwise identical fields are not equal; callers needing value-equality between contexts MUST be able to pin an explicit shared key.
  <sub>spec · `docs/product-spec/07-execution-context-model.md:14` · high · sha:5a9eacfb1c53</sub>
- Registration MUST happen at promotion time, not at head-context construction -- constructing the initial dispatch context MUST NOT auto-register it, so a dispatch context never promoted leaves no store entry and its close is a harmless no-op.
  <sub>spec · `docs/product-spec/07-execution-context-model.md:15` · high · sha:5a9eacfb1c53</sub>
- The context store MUST support an unconditional overwrite operation (install-or-replace, never throwing) used by promotion, and a reject-on-duplicate insert operation (install only if absent) that admits exactly one winner under concurrency and fails all others with an error naming the key.
  <sub>spec · `docs/product-spec/07-execution-context-model.md:20` · high · sha:5a9eacfb1c53</sub>
- Closing a context MUST evict the store entry conditionally on reference identity, removing the slot only when the current occupant is the closing context (never by value equality), and removing a non-existent or already-replaced slot MUST be a well-defined no-op.
  <sub>spec · `docs/product-spec/07-execution-context-model.md:21` · high · sha:5a9eacfb1c53</sub>
- Only the context currently occupying the shared store slot (the furthest-reached link in the promotion chain) evicts on close; closing an intermediate link that was already promoted is a no-op.
  <sub>spec · `docs/product-spec/07-execution-context-model.md:21` · high · sha:5a9eacfb1c53</sub>
- Looking up an unknown key MUST return an explicit absent result rather than throw, and removing an unknown or already-removed key MUST be a no-op, so double-close and cleanup-path closes are well-defined.
  <sub>spec · `docs/product-spec/07-execution-context-model.md:22` · high · sha:5a9eacfb1c53</sub>
- The cap-draining strategy SHOULD be a post-insert drain loop (drain until at or under the cap) rather than a single check-then-evict, so concurrent insert bursts converge to the bound instead of overshooting.
  <sub>spec · `docs/product-spec/07-execution-context-model.md:27` · high · sha:5a9eacfb1c53</sub>
- Each context MUST carry a correlation/instrumentation bundle exposing at minimum a trace id, a span id, trace flags, trace state, a trace-id encoding flavor, validity and remoteness flags, an active span, and a per-operation tracer factory, W3C Trace Context compatible for cross-service propagation.
  <sub>spec · `docs/product-spec/07-execution-context-model.md:31` · high · sha:5a9eacfb1c53</sub>
- A disabled-tracing/no-op instrumentation bundle MUST be available as the default, with reserved invalid sentinels (all-zero trace id, all-zero span id, zero flags, empty state), isValid false, isRemote false, a no-op span, and a no-op tracer factory.
  <sub>spec · `docs/product-spec/07-execution-context-model.md:31` · high · sha:5a9eacfb1c53</sub>
- A context SHOULD carry an optional operation name (a schema-defined operation id, or absent), MUST carry it forward unchanged across every promotion, and MUST keep it advisory only, exposed to the tracing seam without influencing the request, dispatch decision, or store key.
  <sub>spec · `docs/product-spec/07-execution-context-model.md:32` · high · sha:5a9eacfb1c53</sub>
- The per-operation tracer factory SHOULD default to a no-op emitting nothing so untraced call sites pay zero tracing cost, and its factory method MUST be safe to invoke concurrently.
  <sub>spec · `docs/product-spec/07-execution-context-model.md:32` · high · sha:5a9eacfb1c53</sub>
- When folding thread-local diagnostic context into a log event, only allow-listed keys are folded; the default allow-list is exactly {trace.id, span.id}, a null (absent) allow-list folds every present key, and keys with null values are skipped, to prevent arbitrary application context from leaking into SDK-owned events.
  <sub>spec · `docs/product-spec/15-instrumentation-and-observability.md:20-20` · high · sha:1b678eca176d</sub>
- Adapters that move work/callbacks onto another thread should propagate the caller's diagnostic logging context across the hop (capture on the boundary thread, reinstate on the executing/callback thread) so post-hop log events retain correlation; this is an observability guarantee, not a functional one, so an adapter that omits it still executes exchanges correctly.
  <sub>spec · `docs/product-spec/18-asynchronous-runtime-adapter-contract.md:20-20` · high · sha:f1bf00174456</sub>
- When an adapter reinstates a captured context, it must first save the executing thread's prior context, install the captured context only for the work's duration, and restore the prior context afterward — including when the work throws — so a reused/pooled thread's own context is never clobbered.
  <sub>spec · `docs/product-spec/18-asynchronous-runtime-adapter-contract.md:21-21` · high · sha:f1bf00174456</sub>
- When an adapter propagates logging context, capture must occur at the point that identifies the logical caller — per-subscription for cold/reusable stream or promise objects, per-task-submission for executor decorators — not at object-construction time, so a reused async object picks up the live context of each use.
  <sub>spec · `docs/product-spec/18-asynchronous-runtime-adapter-contract.md:22-22` · high · sha:f1bf00174456</sub>
- When an adapter propagates logging context, capture and restore must be safe when no logging-context backend is installed: an absent context captures as empty, and reinstating an empty context clears the target thread's context rather than raising.
  <sub>spec · `docs/product-spec/18-asynchronous-runtime-adapter-contract.md:23-23` · high · sha:f1bf00174456</sub>
- On runtimes where a newly created worker does not inherit the spawning thread's logging context (lightweight threads or plain thread-local contexts), an adapter that propagates logging context must explicitly transfer it at the thread-creation boundary, distinct from any carrier-hop guarantee the runtime provides.
  <sub>spec · `docs/product-spec/18-asynchronous-runtime-adapter-contract.md:24-24` · high · sha:f1bf00174456</sub>

## Constraints
- Each call's store key MUST be unique per call and MUST NOT be derived from the trace identifier, or the trace+span pair, alone, so two concurrent calls sharing a trace id or even a span id receive distinct keys and never evict each other.
  <sub>spec · `docs/product-spec/07-execution-context-model.md:13` · high · sha:5a9eacfb1c53</sub>
- Contexts MUST be immutable and shareable without external synchronization, and the store MUST be thread-safe such that contexts with distinct call keys can be registered, overwritten, and removed concurrently without external locking.
  <sub>spec · `docs/product-spec/07-execution-context-model.md:19` · high · sha:5a9eacfb1c53</sub>
- The context store MUST be bounded, enforcing a maximum number of tracked entries and draining back to at or below that cap after each insert, as a backstop so a caller who fails to close a context on an exception path leaks at most the cap's worth of entries.
  <sub>spec · `docs/product-spec/07-execution-context-model.md:26` · high · sha:5a9eacfb1c53</sub>
- The context store MUST keep the pinned request/response graph reachable while a context remains stored; reimplementations MUST NOT hold contexts by weak or soft references, and MUST treat the bounded cap, not garbage collection, as the leak backstop.
  <sub>spec · `docs/product-spec/07-execution-context-model.md:26` · high · sha:5a9eacfb1c53</sub>
- Eviction victim selection in the context store is arbitrary -- the store provides no ordering and no guarantee that any particular entry, including the just-inserted one, survives an insert that trips the cap, and a port MUST NOT rely on any specific entry surviving.
  <sub>spec · `docs/product-spec/07-execution-context-model.md:27` · high · sha:5a9eacfb1c53</sub>
- Because the default no-op instrumentation bundle shares constant identifiers across every untraced call, call-key derivation MUST remain call-unique even when every bundle field is identical.
  <sub>spec · `docs/product-spec/07-execution-context-model.md:31` · high · sha:5a9eacfb1c53</sub>

## Conclusions
- Trace ids cannot be used alone for call-key derivation because a disabled-tracing context shares one constant trace id across every untraced call, an inbound distributed trace shares one trace id across many spans, and a tracer may reuse a span id.
  <sub>spec · `docs/product-spec/07-execution-context-model.md:13` · high · sha:5a9eacfb1c53</sub>
- Value-equality removal is rejected for context store eviction because contexts are value-equal, so a value-equality remove could let a stale context evict a structurally-identical live sibling.
  <sub>spec · `docs/product-spec/07-execution-context-model.md:21` · high · sha:5a9eacfb1c53</sub>
- The context store is bounded rather than left unbounded because a registered context strongly pins the full request-and-response graph, including a possibly-unread body holding a connection.
  <sub>spec · `docs/product-spec/07-execution-context-model.md:26` · high · sha:5a9eacfb1c53</sub>

## Reference
- A single in-flight call's correlation state is modeled as a one-way promotion chain of three immutable context flavors, each carrying a shared instrumentation bundle and a single call-unique key, registered in a bounded process-wide store keyed by that call key.
  <sub>spec · `docs/product-spec/07-execution-context-model.md:3` · high · sha:5a9eacfb1c53</sub>
- The operation name is introduced at the request stage as an argument to the dispatch-to-request promotion.
  <sub>spec · `docs/product-spec/07-execution-context-model.md:8` · high · sha:5a9eacfb1c53</sub>
- The reference implementation's default call key appends a process-wide monotonic counter to a traceId:spanId rendering.
  <sub>spec · `docs/product-spec/07-execution-context-model.md:13` · high · sha:5a9eacfb1c53</sub>

## Conflicts

## Superseded
