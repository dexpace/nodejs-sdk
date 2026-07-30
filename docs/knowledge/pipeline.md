# pipeline

## Rules
- Steps MUST execute in a single fixed total order derived from stage assignment -- a step in a lower-ordered stage runs before (wraps) a step in a higher-ordered stage on the inbound path and observes the response later on the outbound path, and this cross-stage order is deterministic and independent of insertion order.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:9` · high · sha:33e9443472ce</sub>
- The runtime MUST preserve the pillar precedence chain REDIRECT to RETRY to AUTH to LOGGING to SERDE (outer to inner), plus an outermost pre-redirect slot outside both loops and a terminal SEND hop innermost, and a step's placement relative to these boundaries determines whether it sees per-hop/per-attempt responses or only the single terminal response.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:10` · high · sha:33e9443472ce</sub>
- The stage list SHOULD interleave user-extensible slots around each pillar (a pre and post slot) and SHOULD use sparse numeric order keys so new stages can be inserted without renumbering.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:11` · high · sha:33e9443472ce</sub>
- Installing a distinct second step onto an occupied pillar stage, via any add or a bulk reload, MUST fail fast naming both step types and pointing at the replace path, rather than silently overwriting.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:12` · high · sha:33e9443472ce</sub>
- Re-installing the same step onto its pillar stage MUST be idempotent, distinguished by reference identity, not value equality.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:12` · high · sha:33e9443472ce</sub>
- An empty pipeline MUST dispatch directly to the terminal transport, threading the caller's per-call options, and SHOULD do so without allocating per-call cursor state.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:16` · high · sha:33e9443472ce</sub>
- The built runtime MUST be immutable after construction, and each send MUST allocate its own per-call cursor so concurrent calls share no mutable pipeline state.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:16` · high · sha:33e9443472ce</sub>
- Steps MUST be safe for concurrent invocation, with per-request mutable state living in the per-call cursor, never on the step.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:16` · high · sha:33e9443472ce</sub>
- Each step MUST be bidirectional -- it receives the inbound request, may invoke the rest of the chain, may inspect or substitute the outbound response, and may short-circuit by returning a synthetic response without invoking the chain.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:17` · high · sha:33e9443472ce</sub>
- Invoking the next step MUST advance a monotonic cursor and invoke it; when exhausted it MUST dispatch the current in-flight request to the terminal transport, threading the caller's per-call options, and the cursor MUST only move forward within a single un-forked drive.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:17` · high · sha:33e9443472ce</sub>
- A substituted request MUST propagate to every downstream step and the terminal dispatch.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:17` · high · sha:33e9443472ce</sub>
- A step that drives the downstream chain more than once (retry re-attempting, redirect following a hop, auth retrying after a challenge) MUST fork a fresh cursor for each re-drive rather than reusing the same next handle; reusing the handle resumes past already-visited steps and MUST be treated as a defect.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:18` · high · sha:33e9443472ce</sub>
- A port MUST provide an equivalent cursor-fork primitive and its wrapping pillar steps MUST use it.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:18` · high · sha:33e9443472ce</sub>
- A forked cursor MUST resume from the same position as its parent, carry the current in-flight request, and share the immutable options, with forks advancing independently.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:18` · high · sha:33e9443472ce</sub>
- The caller's per-call options MUST be carried unchanged for the entire call, including across every re-drive fork, readable by any step, and threaded into the terminal dispatch; options MUST be immutable/shared, not copied-and-diverged per fork.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:19` · high · sha:33e9443472ce</sub>
- A wrapping step that re-drives the chain MUST release each superseded intermediate response, closing its body before the next drive, and MUST NOT close the response it ultimately hands back to the caller, so close-responsibility passes outward.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:20` · high · sha:33e9443472ce</sub>
- On paths that abandon a re-drive (redirect cycle, non-replayable body, budget exhausted), the in-flight response MUST be returned unclosed.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:20` · high · sha:33e9443472ce</sub>
- Non-pillar stages MUST hold an ordered sequence where append adds to the tail and prepend to the head, preserving relative order through build and any re-bucketing edit.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:24` · high · sha:33e9443472ce</sub>
- The surgical insert-after/insert-before and replace edits MUST act relative to the first existing instance of an anchor type, and the inserted/replacing step MUST declare the same stage as the anchor; a cross-stage insert/replace MUST be rejected.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:24` · high · sha:33e9443472ce</sub>
- Remove MUST delete every instance of a step type, preserving relative order, and be a no-op when the type is absent.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:24` · high · sha:33e9443472ce</sub>
- An insert-relative or replace edit whose anchor type is absent MUST fail identifying the missing type.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:24` · high · sha:33e9443472ce</sub>
- Every mutation that re-buckets steps by stage MUST re-derive the flattened order deterministically, so the observable ordering after an edit equals building the same set from scratch.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:25` · high · sha:33e9443472ce</sub>
- A bulk reload MUST be all-or-nothing -- a pillar collision leaves the existing collection completely unchanged rather than a partial rebuild.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:25` · high · sha:33e9443472ce</sub>
- The standard-resilience preset MUST install into empty pillar slots only, validating up front that no target pillar is occupied and rejecting the whole call, installing nothing, if any pillar is occupied.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:25` · high · sha:33e9443472ce</sub>
- build() MUST produce the ordered sequence by flattening stages in declaration order, skipping SEND, into an immutable runtime that exposes a read-only, ordered view of its steps.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:26` · high · sha:33e9443472ce</sub>
- The shipped pillar families SHOULD lock their stage assignment so a subclass cannot relocate out of its pillar.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:26` · high · sha:33e9443472ce</sub>
- A step whose correctness depends on the single terminal response, such as status-to-typed-error mapping, MUST occupy the outermost pre-redirect slot so it runs outside both loops, and on a non-error status MUST return the response untouched.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:26` · high · sha:33e9443472ce</sub>
- The runtime MUST itself implement the transport SPI, delegating execute/execute-async to its own send/send-async (with and without options), so a configured pipeline can stand in wherever a transport is expected and options survive the indirection.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:30` · high · sha:33e9443472ce</sub>
- Closing the pipeline MUST be a no-op with respect to the underlying transport -- the pipeline never owns its transport and MUST NOT close it.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:30` · high · sha:33e9443472ce</sub>
- The runtime SHOULD offer convenience constructors for a step-less pipeline forwarding directly to a transport and a standard pipeline installing the default resilience pillars, sync being redirect+retry+instrumentation and async being retry+instrumentation with a caller-supplied scheduler for non-blocking backoff.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:31` · high · sha:33e9443472ce</sub>
- The async runtime MUST reuse the identical stage identities and staging policy as the sync runtime; the two MUST NOT each re-derive ordering independently.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:35` · high · sha:33e9443472ce</sub>
- An async step MUST NOT throw synchronously to signal a transport/async failure -- it MUST return a future completing exceptionally -- and MAY throw synchronously only for caller-bug argument validation.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:35` · high · sha:33e9443472ce</sub>
- The async runtime MUST defensively normalize any synchronous exception from a step's async entry point, or the empty-pipeline dispatch, into an exceptionally-completed future, while fatal/unrecoverable errors propagate synchronously and MUST NOT be swallowed.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:35` · high · sha:33e9443472ce</sub>
- The async terminal response-mapping operator MUST, on success, apply the handler then close the response, tolerating idempotent double-close; on failure it MUST unwrap async-wrapper exceptions to the original cause and MUST close any response accompanying a failure to avoid leaking the body.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:36` · high · sha:33e9443472ce</sub>
- The sync-to-async bridge MUST require a caller-supplied executor with no default, run the wrapped synchronous pipeline as a single opaque unit on that executor so its steps stay synchronous on the worker and do not gain per-step concurrency, and thread per-call options into the wrapped send.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:40` · high · sha:33e9443472ce</sub>
- Cancelling the sync-to-async bridge's future with interruption MUST interrupt the worker running the in-flight send, and cancelling without interruption MUST complete as cancelled without interrupting.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:40` · high · sha:33e9443472ce</sub>
- The async-to-sync bridge MUST block on the async result per call while preserving options and MUST honor thread interruption -- on interrupt it restores the flag, cancels the in-flight future, and surfaces an interrupted-I/O error.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:40` · high · sha:33e9443472ce</sub>
- The builder SHOULD provide two unambiguous ways to seed from an existing pipeline -- FLATTEN, which copies its steps and transport so they run in the same loops, versus NEST, which treats it as an opaque transport so the new steps run once outside the nested loops -- and a port MUST make the flatten-vs-nest choice explicit rather than accidental.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:41` · high · sha:33e9443472ce</sub>
- The response-side outcome MUST be a closed sum type with exactly two variants -- a success carrying a response and a failure carrying a throwable -- mutually exclusive and jointly exhaustive, with derivable accessors and a fold that applies exactly one of two branches at most once per call.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:45` · high · sha:33e9443472ce</sub>
- The unified orchestrator MUST catch every throwable from any request-chain step and from the transport invocation, convert it into a Failure, and thread it through the response recovery chain; no throwable from the pre-request phase or the transport may bypass the recovery hooks.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:46` · high · sha:33e9443472ce</sub>
- The request recovery chain MUST apply its ordered steps as a sequential left-to-right fold where the output of step N is the input of step N+1; an empty chain returns the input unchanged, and a throwing step aborts the remainder and propagates.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:47` · high · sha:33e9443472ce</sub>
- Response steps (response-to-response) MUST run only when the current outcome is a Success; on a Failure the entire response-step phase is skipped.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:48` · high · sha:33e9443472ce</sub>
- Recovery steps MUST be applied to every outcome, successes and failures, sequentially and always, observing the terminal outcome including a failure a response step just produced by throwing.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:48` · high · sha:33e9443472ce</sub>
- The fold order MUST be all response steps first (on the success path), then all recovery steps, in declared order within each group.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:48` · high · sha:33e9443472ce</sub>
- If a response step throws, its throwable MUST be converted into a Failure fed to the subsequent recovery steps, never propagated out of the response chain, so error-mapping steps flow through recovery exactly like a transport error.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:49` · high · sha:33e9443472ce</sub>
- If a recovery step throws, its throwable MUST be wrapped into a Failure fed to the next recovery step, never aborting the remaining recovery steps, and the chain's apply operation MUST NOT throw under any input.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:49` · high · sha:33e9443472ce</sub>
- Recovery steps SHOULD surface errors by returning a Failure rather than throwing.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:49` · high · sha:33e9443472ce</sub>
- The orchestrator's dispatch MUST unwrap the final outcome by returning the contained response on Success, or rethrowing the contained throwable unchanged on Failure with no wrapping or substitution; any typed-exception surfacing must be done by a recovery step constructing the error and returning a Failure.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:50` · high · sha:33e9443472ce</sub>
- When wrapping a cancellation/interruption throwable into a Failure, the wrapping helper MUST re-assert the cancellation signal on the current context before returning, so code later blocked on the outcome still observes the cancellation.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:50` · high · sha:33e9443472ce</sub>
- When a response or recovery step throws while holding a Success response, the pipeline MUST close/release that in-hand response before wrapping the throwable, attaching any close error as suppressed so it never masks the primary, releasing the response exactly once.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:51` · high · sha:33e9443472ce</sub>
- When a step handed a Success deliberately returns a different outcome, whether a Success-to-Failure transform or a substitute Success, the pipeline MUST NOT auto-close the discarded original response; the transforming step owns releasing the response it drops.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:51` · high · sha:33e9443472ce</sub>
- A chain's step lists MUST behave as immutable after construction, and the response recovery chain MUST defensively copy both its lists at construction.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:52` · high · sha:33e9443472ce</sub>
- Recovery chain steps MUST be safe for concurrent invocation, with per-request state in the passed context or the value being transformed, never on the step.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:52` · high · sha:33e9443472ce</sub>
- The status-to-typed-exception mapping step MUST treat only 400..599 as errors, mapping to the matching typed exception which becomes a Failure, and return all other statuses unchanged.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:53` · high · sha:33e9443472ce</sub>
- Before mapping an error-status response, both initially and on a re-sent error response, the error body MUST be buffered into a bounded (1 MiB), replayable in-memory copy so the connection is released promptly and the body remains readable on the Failure, with the same bound shared across all buffering paths and the cap a hard truncation with no marker.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:53` · high · sha:33e9443472ce</sub>
- Pillar stages are validated at composition time to admit at most one step (PIPE-4/PIPE-5), distinguished by reference identity for idempotent re-installation (PIPE-6).
  <sub>design · `docs/sdk-design-nodejs/05-pipeline-architecture.md:20-21` · high · sha:16ad31311df7</sub>
- The port's composition function exposes two distinct capabilities to a step: a plain next() that enforces single-invocation for every ordinary step (satisfying PIPE-15), and an explicit fork(): Next available only to steps occupying a pillar stage, which captures the calling step's position in the flattened array and returns a new, independently-advancing continuation bound to that same starting position each time it is called.
  <sub>design · `docs/sdk-design-nodejs/05-pipeline-architecture.md:30-35` · high · sha:16ad31311df7</sub>
- RECOV-2's requirement that every throwable from any step or the transport invocation must be caught and converted to a Failure is implemented as one try/catch wrapping the whole orchestrator dispatch, converting a thrown value into the Failure variant.
  <sub>design · `docs/sdk-design-nodejs/05-pipeline-architecture.md:50-53` · high · sha:16ad31311df7</sub>

## Constraints
- A pillar stage MUST admit at most one step; the configurable pillars are REDIRECT, RETRY, AUTH, LOGGING, and SERDE.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:12` · high · sha:33e9443472ce</sub>
- The terminal SEND stage MUST be reserved for the transport hop, MUST NOT hold a user step, and flattening MUST skip it.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:12` · high · sha:33e9443472ce</sub>
- The async standard pipeline MUST NOT follow HTTP redirects at the pipeline layer, since there is no async redirect pillar; a 3xx surfaces verbatim unless redirect following is enabled on the transport, and a port MUST document this asymmetry with the sync standard pipeline.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:36` · high · sha:33e9443472ce</sub>
- A port MUST NOT collapse the stage-based pipeline and recovery-chain primitives into one layer -- the stage pipeline owns ordering and re-drive-with-fork, while the recovery chain owns the sum-type fold and the uniform-failure guarantee.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:59` · high · sha:33e9443472ce</sub>
- A thrown value in JavaScript can legally be any value, not only an Error instance.
  <sub>design · `docs/sdk-design-nodejs/05-pipeline-architecture.md:52-53` · high · sha:16ad31311df7</sub>

## Conclusions
- The stage-based pipeline and the recovery-chain primitives share one backoff calculator and one pacing-header parser so their retry behavior cannot drift.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:3` · high · sha:33e9443472ce</sub>
- A closed two-variant outcome is what lets one code path handle a throwable and a response identically.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:45` · high · sha:33e9443472ce</sub>
- The stage-based pipeline is used as the composition surface for assembling a client because it is where redirect, retry, auth, logging/instrumentation, and serialization concerns are ordered as pillar steps, where per-call cursors and forks drive re-attempts, and where a configured pipeline becomes a transport others can nest, and it has a real async mirror.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:57` · high · sha:33e9443472ce</sub>
- The recovery-chain primitives are used as the resilience layer when a concern must observe every outcome uniformly, in particular error-mapping, retry, or rescue logic that must see a transport failure and a response failure through one code path and must never let a pre-transport throw bypass it; the recovery layer is synchronous, with its async equivalent expressed through the stage-based async pipeline.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:59` · high · sha:33e9443472ce</sub>
- The recovery-aware retry stack enforces a total-timeout budget that the stage-based retry step intentionally omits, and a port unifying retry entry points MUST make that budget explicitly opt-in.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:59` · high · sha:33e9443472ce</sub>
- The stage-based pipeline (§8.1 of the spec) is structurally identical to the "onion" middleware composition pattern already implemented by every Koa-descended Node HTTP framework, including Koa itself, tRPC's middleware, and Apollo Server's plugin model.
  <sub>design · `docs/sdk-design-nodejs/05-pipeline-architecture.md:3-9` · high · sha:16ad31311df7</sub>
- The port must deliberately diverge from an off-the-shelf library like koa-compose for PIPE-15/PIPE-16's fork semantics, because a pillar step (redirect following a hop, retry re-attempting, auth retrying after a 401 challenge) must invoke a fresh continuation each time, resuming from the same position in the step array as its own invocation, never reusing an already-invoked next handle.
  <sub>design · `docs/sdk-design-nodejs/05-pipeline-architecture.md:24-28` · high · sha:16ad31311df7</sub>
- PIPE-28's requirement that the async runtime reuse identical stage identities as the sync runtime is trivially, structurally true in the port because there is no second, synchronous pipeline whose ordering could drift from the async one.
  <sub>design · `docs/sdk-design-nodejs/05-pipeline-architecture.md:55-57` · high · sha:16ad31311df7</sub>
- PIPE-33/PIPE-34's sync-to-async and async-to-sync bridges have no Node counterpart to build, since there is no synchronous side to bridge from or to, eliminating two entire subsystems of bridge code the reference needs.
  <sub>design · `docs/sdk-design-nodejs/05-pipeline-architecture.md:57-61` · high · sha:16ad31311df7</sub>

## Reference
- The SDK has two cooperating pipeline layers -- the stage-based pipeline, the user-facing dispatch runtime where cross-cutting concerns become discrete bidirectional steps on a fixed totally-ordered list of named stages, and the recovery-chain primitives, the resilience layer beneath resilience steps threading a closed two-variant outcome through a fold so every failure is observed uniformly.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:3` · high · sha:33e9443472ce</sub>
- The SERDE pillar is a reserved stage slot with no shipped behavior.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:10` · high · sha:33e9443472ce</sub>
- Append-all MUST preserve the batch's iteration order within a stage, while prepend-all (each element prepended individually) results in the reversed batch order; a port MUST document this asymmetry.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:26` · high · sha:33e9443472ce</sub>
- In the reference implementation the request recovery chain does not defensively copy, retaining the caller's read-only list reference directly, an asymmetry a porter must not assume away; a port SHOULD copy there too.
  <sub>spec · `docs/product-spec/08-execution-pipelines.md:52` · high · sha:33e9443472ce</sub>
- A pipeline step is a function of type `(request: Request, next: Next) => Promise<Response>`, where `Next = () => Promise<Response>`.
  <sub>design · `docs/sdk-design-nodejs/05-pipeline-architecture.md:12-16` · high · sha:16ad31311df7</sub>
- PIPE-1 through PIPE-8's fixed stage ordering is a frozen Stage enum following the outer-to-inner precedence chain PRE_REDIRECT → REDIRECT → RETRY → AUTH → LOGGING → SERDE → SEND, using sparse numeric stage keys per PIPE-3.
  <sub>design · `docs/sdk-design-nodejs/05-pipeline-architecture.md:18-20` · high · sha:16ad31311df7</sub>
- Pipeline composition flattens the staged buckets into one ordered array exactly once, at build time (PIPE-25), producing an immutable runtime.
  <sub>design · `docs/sdk-design-nodejs/05-pipeline-architecture.md:21-22` · high · sha:16ad31311df7</sub>
- koa-compose treats calling next() twice as a bug and throws "next() called multiple times," which is the correct default for ordinary middleware but the wrong default for a pillar step whose job is controlled re-invocation.
  <sub>design · `docs/sdk-design-nodejs/05-pipeline-architecture.md:28-30` · high · sha:16ad31311df7</sub>
- The recovery-chain Outcome<T> primitive is modeled as a TypeScript discriminated union: `{ readonly kind: 'success'; readonly value: T } | { readonly kind: 'failure'; readonly error: unknown }`.
  <sub>design · `docs/sdk-design-nodejs/05-pipeline-architecture.md:37-44` · high · sha:16ad31311df7</sub>
- fold() over the Outcome union gets compiler-checked exhaustiveness via a never-typed default branch, satisfying RECOV-1's requirement for mutually exclusive, jointly exhaustive branch application with no runtime discriminant logic beyond a switch on kind.
  <sub>design · `docs/sdk-design-nodejs/05-pipeline-architecture.md:46-48` · high · sha:16ad31311df7</sub>
- The request-recovery chain (RECOV-3) and response/recovery-step folds (RECOV-4 through RECOV-9) are implemented as plain async reduce-style folds over an ordered array of step functions.
  <sub>design · `docs/sdk-design-nodejs/05-pipeline-architecture.md:48-50` · high · sha:16ad31311df7</sub>

## Conflicts
- **design vs styleguide: `enum` for the pipeline Stage ordering** — the design describes the fixed stage ordering as a "frozen `Stage` enum" with sparse numeric keys; the styleguide bans TypeScript `enum` outright (a deviation it records deliberately against Google's guide) and enforces the ban with `erasableSyntaxOnly`, prescribing a literal union or an `as const` object plus a derived type instead. Whether the design means a literal TypeScript `enum` or an `as const` map needs settling before implementation.
  <sub>design `docs/sdk-design-nodejs/05-pipeline-architecture.md:18-20` · styleguide `/home/mohammad/Projects/dexpace/styleguide/typescript/03-the-type-system.md:191-209` · styleguide `/home/mohammad/Projects/dexpace/styleguide/typescript/README.md:78` · unresolved 2026-07-25</sub>

## Superseded
