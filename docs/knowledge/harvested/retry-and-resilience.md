# retry-and-resilience

## Rules
- Retry, redirect, and authentication-challenge replay MUST all consult the body's replayability before re-sending a body-bearing request: such a request is eligible only when its body reports replayable, and a consumed single-use body MUST NOT be re-sent on any of these paths (BODY-4).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:18-18` · high · sha:c2bf15dc8a06</sub>
- On the retry path specifically, a body-less request's re-send eligibility MUST gate on method idempotency rather than replayability, so only idempotent methods are retried when there is no body, meaning a body-less non-idempotent POST is not retried (BODY-5).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:19-19` · high · sha:c2bf15dc8a06</sub>
- The retryable-status classifier MUST be single-sourced and treat exactly 408, 429, and all of 500-599 except 501 and 505 as retryable; this is the single definition the response-carrying exception flag and the stage stack's default predicate derive from, while the recovery stack layers its own configurable status allow-list on top (RETRY-1).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:9` · high · sha:9efbe276001e</sub>
- The retryable-throwable set MUST be defined in exactly one place -- any throwable that is, or has anywhere in its cause chain, an I/O error or a timeout error, found via an iterative, identity-tracking cause-chain walk that terminates on a cyclic chain (RETRY-2).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:10` · high · sha:9efbe276001e</sub>
- A response-carrying exception MUST derive its own retryable flag from the single status classifier at construction, not a hardcoded per-subclass constant (RETRY-3).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:10` · high · sha:9efbe276001e</sub>
- A transport-level failure that produced no complete response, such as connection refused, TLS/DNS failure, socket read timeout, or peer reset, MUST be classified retryable unconditionally at the condition level, with safety gated separately (RETRY-4).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:10` · high · sha:9efbe276001e</sub>
- A request is re-sendable if and only if it has no body and its method is idempotent, or it has a body and that body is replayable; both retry stacks MUST apply this identical rule (RETRY-5 / RECOV-18).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:11` · high · sha:9efbe276001e</sub>
- When a request is not re-sendable, the retry logic MUST perform exactly one attempt and MUST NOT retry, even when the condition is retryable and even when there is no body to physically re-send (a bare non-idempotent POST) (RETRY-7).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:12` · high · sha:9efbe276001e</sub>
- Retry eligibility MUST require both a retryable condition and a re-sendable request; neither implies the other (RETRY-8).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:12` · high · sha:9efbe276001e</sub>
- The unjittered exponential delay MUST be initialDelay times multiplier raised to (attempt minus 1), with attempt 1-indexed such that attempt 1 is the wait before the first retry, clamped to a maximum delay cap (RETRY-9 / RECOV-21).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:16` · high · sha:9efbe276001e</sub>
- Symmetric jitter MUST draw the effective delay uniformly from [d*(1-j/2), d*(1+j/2)] with midpoint d, j=0 returning d, j constrained to [0,1], a degenerate sub-nanosecond range returning the base delay, and a negative sample floored to zero (RETRY-10).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:16` · high · sha:9efbe276001e</sub>
- Delay computation MUST be overflow-safe, saturating to the cap rather than throwing, and MUST reject an attempt value less than 1 (RETRY-11).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:16` · high · sha:9efbe276001e</sub>
- The pacing-header parser MUST recognize Retry-After as delta-seconds (integer and fractional), Retry-After as an RFC 1123 HTTP-date tolerant of an informational weekday and single-digit day, retry-after-ms and x-ms-retry-after-ms as integer milliseconds, and X-RateLimit-Reset as Unix epoch seconds whose delta is positively jittered to [100%,120%] (RETRY-15 / RECOV-24 / RECOV-25).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:17` · high · sha:9efbe276001e</sub>
- The pacing-header parser MUST be total and never throw; malformed, negative, or out-of-range values MUST map to no hint (null), not a zero delay, so the caller falls back to backoff rather than hammering the server (RETRY-16 / RECOV-23).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:17` · high · sha:9efbe276001e</sub>
- A valid HTTP-date or epoch value already in the past MUST yield a zero delay (retry immediately), distinct from an unparseable value which yields no hint (RETRY-17).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:17` · high · sha:9efbe276001e</sub>
- Any computed pacing delta MUST be clamped to a finite ceiling of 365 days before nanosecond conversion (RETRY-18 / RECOV-26).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:17` · high · sha:9efbe276001e</sub>
- Numeric Retry-After parsing MUST be screened by a strict decimal grammar before any float parse, rejecting type-suffixed, hex-float, NaN, and Infinity forms (RETRY-19).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:17` · high · sha:9efbe276001e</sub>
- A present pacing hint MUST override (replace, not augment) the exponential schedule for that single decision; a literal Retry-After hint MUST NOT receive additional symmetric jitter, and where a total-timeout deadline applies the hint MUST still be clamped against it (RETRY-20 / RECOV-22).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:18` · high · sha:9efbe276001e</sub>
- Pacing resolution MUST honor a defined precedence and return the first parseable value -- the recovery stack scans the whole header map with fixed precedence Retry-After numeric then date, then retry-after-ms, then x-ms-retry-after-ms, then X-RateLimit-Reset, while the stage stack walks a caller-configurable ordered header list (RETRY-21).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:18` · high · sha:9efbe276001e</sub>
- A failure while parsing a pacing header MUST NOT mask the real upstream failure; the loop falls back to exponential backoff and the original throwable remains the surfaced error (RETRY-22 / RECOV-29).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:18` · high · sha:9efbe276001e</sub>
- Thread interruption/cancellation MUST never be treated as a retryable failure; on interrupt during a blocking backoff wait, the implementation MUST restore the cancellation flag, cancel any externally-scheduled wake, abort the retry loop, and surface an interrupted-I/O error, and a downstream interrupt surfaced as an interrupted-I/O error is treated as terminal cancellation, not retried (RETRY-23).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:22` · high · sha:9efbe276001e</sub>
- A read-timeout represented as a subtype of the interrupted-I/O error MUST NOT be mistaken for cancellation; it remains a retryable condition (RETRY-24).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:22` · high · sha:9efbe276001e</sub>
- Non-recoverable runtime errors such as out-of-memory and stack overflow MUST NOT be retried, classified retryable, or logged; they MUST be surfaced unchanged with no suppressed-trail attachment (RETRY-25).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:22` · high · sha:9efbe276001e</sub>
- The inter-attempt wait MUST be cancellable/interruptible and MUST NOT pin an execution carrier for its duration; a naive uninterruptible sleep that cannot be cancelled is non-conforming (RETRY-26 / RECOV-27).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:23` · high · sha:9efbe276001e</sub>
- The recovery stack MUST enforce an optional total-timeout budget with per-attempt deadline shrinking, aborting before each attempt if the attempt cap is reached, if elapsed time is at or beyond the budget, or if elapsed plus the next delay would exceed the budget, clamping the delay so it cannot overshoot, with a zero budget disabling the deadline (RETRY-27 / RECOV-20).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:27` · high · sha:9efbe276001e</sub>
- Both retry stacks MUST compute backoff via one shared calculator and shared constants, and their attempt budgets MUST denote the same number of total wire sends under equivalent defaults (RETRY-13 / RETRY-14 / RECOV-30).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:28` · high · sha:9efbe276001e</sub>
- In the recovery stack, for a failure carrying a received response, the configured retryable-status set MUST be authoritative, able to both widen and narrow relative to the built-in classifier, while a no-response transport failure falls back to its always-retryable flag (RETRY-37 / RECOV-17).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:29` · high · sha:9efbe276001e</sub>
- A re-sent response whose error status is in the configured retryable-status set MUST be re-mapped into a typed failure so the loop keeps evaluating the budget, e.g. a 503,503,200 sequence reaches the 200; all other re-sent responses pass through as Success (RETRY-36 / RECOV-19).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:29` · high · sha:9efbe276001e</sub>
- A retryable response's body/connection MUST be released before the backoff wait so a socket is not pinned across the delay; the pacing delay is computed from the still-open response first, and if the retry decision or delay computation throws, the response MUST still be closed before propagating (RETRY-35).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:30` · high · sha:9efbe276001e</sub>
- On terminal failure, every prior failed attempt's exception MUST be attached to the surfaced exception as suppressed, skipping the surfaced instance itself so a reused exception instance cannot trip a self-suppression error, and on eventual success the prior trail MUST be discarded (RETRY-34).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:30` · high · sha:9efbe276001e</sub>
- The asynchronous retry loop MUST be driven by an iterative trampoline; N retries MUST NOT build an N-deep chain of future continuations or stack frames, and a completion warranting another attempt hands control to a single active pump via a re-arm flag rather than recursing (RETRY-30).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:34` · high · sha:9efbe276001e</sub>
- Async backoff delays MUST be scheduled non-blockingly, with a zero-length delay completing inline and re-arming the active pump (RETRY-31).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:34` · high · sha:9efbe276001e</sub>
- If the caller has already completed or cancelled the returned async result, the driver MUST launch no further attempts, and any response arriving from an in-flight attempt MUST be closed rather than leaked (RETRY-32).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:34` · high · sha:9efbe276001e</sub>
- Every terminal path of the async retry loop MUST complete the returned future, with a throwing predicate, delay computation, log call, or synchronous scheduler rejection each completing it exceptionally, closing any open retryable response first (RETRY-33).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:34` · high · sha:9efbe276001e</sub>
- The stage stack's delay resolution MUST follow the precedence caller delay-override, then server pacing headers (response path only), then fixed delay, then exponential backoff, with the exception path skipping the header step (RETRY-39).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:35` · high · sha:9efbe276001e</sub>
- A throwing user delay-override SHOULD be non-fatal, logging and falling back, while a throwing should-retry predicate SHOULD abort the call as a well-typed error, with fatal errors rethrown unchanged in both cases (RETRY-40).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:35` · high · sha:9efbe276001e</sub>
- The stage stack MUST resolve the effective retry count as present-override-wins (validated non-negative), else the configured value, with a negative configured value clamped to the default and zero meaning no retries (RETRY-41).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:35` · high · sha:9efbe276001e</sub>
- All retry policy components MUST be immutable and stateless after construction and safe for concurrent invocation, with every piece of per-call state on the per-call stack/driver, never the shared instance (RETRY-42 / RECOV-28).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:35` · high · sha:9efbe276001e</sub>
- Each retry attempt MUST re-execute the downstream chain with fresh per-attempt continuation state rather than reusing the prior attempt's in-flight chain, and upstream steps MUST NOT mutate the shared in-flight request between attempts (RETRY-44).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:35` · high · sha:9efbe276001e</sub>
- The retry engine MUST NOT shut down or close a caller-supplied scheduler, and a process-wide default scheduler, when used, is likewise never shut down by the SDK (RETRY-45).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:35` · high · sha:9efbe276001e</sub>
- Retry-safety must be decided at the retry step independently of retryability and applied uniformly to protocol and transport failures, so a body-less request is retry-safe only if its method is idempotent (a bare POST is never retried even on a transport error) and a body-bearing request is retry-safe only if its body is replayable (a single-use/streaming body is never re-sent) (XCUT-10).
  <sub>spec · `docs/product-spec/19-cross-cutting-invariants-and-policies.md:24` · high · sha:d6123be82c9e</sub>
- The backoff calculator must apply overflow-safe saturation to the delay cap rather than throwing.
  <sub>design · `docs/sdk-design-nodejs/06-retry-redirect-and-authentication.md:13-14` · high · sha:b0e2bb42d809</sub>
- The port's unified retry step accepts an optional `totalTimeoutMs` budget that is undefined by default (a zero/absent budget disables the deadline), with per-attempt deadline shrinking applied only when that option is supplied.
  <sub>design · `docs/sdk-design-nodejs/06-retry-redirect-and-authentication.md:33-36` · high · sha:b0e2bb42d809</sub>

## Constraints
- The stage-based retry stack MUST NOT impose a total-timeout budget; a port that unifies the stacks MUST make the total-timeout an explicitly opt-in feature rather than always-on (RETRY-28).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:27` · high · sha:9efbe276001e</sub>

## Conclusions
- The retry, auth, and redirect paths query the same replayability property but decline differently: the retry path stops and surfaces the last outcome, the auth path returns the original challenge response unchanged and does not close it, and the redirect path fails loudly; a port need not unify the decline behavior across the three paths (BODY-4).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:18-18` · high · sha:c2bf15dc8a06</sub>
- The body-less idempotency gate is retry-specific; the redirect path re-sends body-less requests per redirect semantics and does not consult idempotency (BODY-5).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:19-19` · high · sha:c2bf15dc8a06</sub>
- 501 and 505 are excluded from the retryable status set because they mean the server cannot fulfill the request regardless of retry (RETRY-1).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:9` · high · sha:9efbe276001e</sub>
- The port single-sources the idempotent-method set, retryable-status set, and shared backoff calculator in one ES module because ES modules are singletons by default, unlike JVM classloaders which can each load their own copy of a class.
  <sub>design · `docs/sdk-design-nodejs/06-retry-redirect-and-authentication.md:1-8` · high · sha:b0e2bb42d809</sub>
- The non-blocking inter-attempt retry wait is implemented as a Promise racing a setTimeout against the same AbortSignal used for the call's own cancellation, clearing the timer on early abort so no dangling timer keeps the event loop alive.
  <sub>design · `docs/sdk-design-nodejs/06-retry-redirect-and-authentication.md:14-18` · high · sha:b0e2bb42d809</sub>
- The port hand-writes a small, strict RFC 1123 date parser for Retry-After headers instead of using `new Date(str)`, because the Date constructor's string parsing is permissive and non-standardized across JS engines and could silently accept a malformed header as a valid instant.
  <sub>design · `docs/sdk-design-nodejs/06-retry-redirect-and-authentication.md:20-27` · high · sha:b0e2bb42d809</sub>
- The port ships a single unified retry step instead of the reference's two cooperating retry stacks (recovery-chain retry with a total-timeout budget and stage-based retry without one), because the port's pipeline layer is a single execution model end to end.
  <sub>design · `docs/sdk-design-nodejs/06-retry-redirect-and-authentication.md:29-33` · high · sha:b0e2bb42d809</sub>

## Reference
- The SDK ships two cooperating retry stacks -- the recovery-chain retry with a total-timeout budget and the stage-based retry step -- both built on one status classifier, one backoff calculator, one pacing-header parser, and one set of tuning constants so behavior cannot drift.
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:3` · high · sha:9efbe276001e</sub>
- Retry happens only when both a retryable condition and a re-sendable request hold; the two axes are orthogonal.
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:7` · high · sha:9efbe276001e</sub>
- The idempotent-method set MUST be single-sourced and equal to {GET, HEAD, OPTIONS, PUT, DELETE}; POST and PATCH are re-sendable only via the replayable-body path (RETRY-6).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:11` · high · sha:9efbe276001e</sub>
- Default retry tuning SHOULD be an initial delay of 200 ms, a multiplier of 2.0, a max delay of 8 s, a jitter of 0.2, and a budget of 3 sends (RETRY-12).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:16` · high · sha:9efbe276001e</sub>
- The recovery stack schedules the wake on a shared scheduler and blocks on the resulting future; the stage-sync stack performs an interruptible sleep that unmounts a virtual-thread carrier; async implementations schedule the delay without blocking a thread (RETRY-26).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:23` · high · sha:9efbe276001e</sub>
- The recovery stack's max-attempts default of 3 equals the stage stack's default max-retries of 2 plus one initial send (RETRY-14).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:28` · high · sha:9efbe276001e</sub>
- The recovery stack's configured retryable-status set is authoritative-contains, not an intersection with the baked-in classifier flag; a port should follow that (RETRY-37).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:29` · high · sha:9efbe276001e</sub>
- Only the async retry stack currently implements the skip-self suppression guard in the reference implementation; a port MUST apply it to both stacks (RETRY-34).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:30` · high · sha:9efbe276001e</sub>
- A fixed-delay configuration MAY force a flat delay disabling backoff and jitter, making the backoff path unreachable (RETRY-43).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:35` · high · sha:9efbe276001e</sub>
- An opt-in server-driven override MAY let a response header force or suppress the retry classification, flipping only classification and remaining subject to the attempt cap and the re-send-safety gate (RETRY-29).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:35` · high · sha:9efbe276001e</sub>
- An optional per-attempt request header MAY stamp the 1-based attempt ordinal on a fresh per-attempt copy, never mutating the captured template and preserving any idempotency key, allocating nothing when disabled (RETRY-38 / RECOV-31).
  <sub>spec · `docs/product-spec/09-retry-and-resilience.md:35` · high · sha:9efbe276001e</sub>
- A shared retryability classifier should treat HTTP status 408, 429, and all 5xx except 501/505 as retryable, and should treat a throwable as retryable iff it or any cause in its chain is an IO/timeout error (cause-chain traversal cycle-safe); where implemented, this exact status set is a hard contract (CFG-35).
  <sub>spec · `docs/product-spec/16-configuration.md:58-58` · high · sha:367e27ec6481</sub>
- An idempotent method is an HTTP method whose repetition has the same effect as a single invocation; the SDK's idempotent set is `{GET, HEAD, OPTIONS, PUT, DELETE}`, used as the retry-safety gate for body-less requests.
  <sub>spec · `docs/product-spec/appendix-a-glossary.md:31` · high · sha:f0b3d2058626</sub>
- A replayable body is a request body whose write can be invoked more than once producing identical bytes; a non-replayable (single-use, stream-backed) body trips a consume-once guard on a second write.
  <sub>spec · `docs/product-spec/appendix-a-glossary.md:55` · high · sha:f0b3d2058626</sub>
- Retry-safety is whether it is safe to replay a specific request, decided at the retry step from HTTP-method idempotency for body-less requests or body replayability for body-bearing requests, and is orthogonal to retryability.
  <sub>spec · `docs/product-spec/appendix-a-glossary.md:59` · high · sha:f0b3d2058626</sub>
- The port's retry policy module exports a frozen `IDEMPOTENT_METHODS` set, a `RETRYABLE_STATUSES` set, and a `computeDelay()` function that every consumer imports from the same module specifier.
  <sub>design · `docs/sdk-design-nodejs/06-retry-redirect-and-authentication.md:5-8` · high · sha:b0e2bb42d809</sub>
- The backoff calculator is a pure function taking the attempt number, a settings object (`initialDelayMs`, `multiplier`, `maxDelayMs`, `jitter`), and an injectable random source defaulting to `Math.random` that is overridable in tests.
  <sub>design · `docs/sdk-design-nodejs/06-retry-redirect-and-authentication.md:10-13` · high · sha:b0e2bb42d809</sub>

## Conflicts

## Superseded
