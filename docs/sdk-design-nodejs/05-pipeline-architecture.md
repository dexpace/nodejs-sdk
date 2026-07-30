## 5. Pipeline Architecture

The two cooperating layers translate cleanly because Node's own web-framework ecosystem already converged on almost
exactly this shape independently. The **stage-based pipeline** (§8.1 of the spec) — an ordered list of bidirectional
steps, each able to inspect the inbound request, invoke the rest of the chain, and inspect/substitute the outbound
response — is structurally identical to the "onion" middleware composition pattern every Koa-descended Node HTTP
framework (Koa itself, tRPC's middleware, Apollo Server's plugin model) already implements. This is worth stating
plainly: the port is not fighting the ecosystem to reproduce this layer, it is reusing an idiom Node engineers
already carry into the codebase.

A step is a function, not an interface implementation:

```
type Step = (request: Request, next: Next) => Promise<Response>
type Next = () => Promise<Response>
```

**PIPE-1**–**PIPE-8**'s fixed stage ordering (an outer-to-inner precedence chain
`PRE_REDIRECT → REDIRECT → RETRY → AUTH → LOGGING → SERDE → SEND`, sparse numeric stage keys per **PIPE-3**) is a
frozen `Stage` enum with pillar stages validated at composition time to admit at most one step (**PIPE-4**/**PIPE-5**,
distinguished by reference identity for idempotent re-installation per **PIPE-6**). Composition flattens the staged
buckets into one ordered array exactly once, at build time (**PIPE-25**), producing an immutable runtime.

The one place the port must deliberately diverge from an off-the-shelf library like `koa-compose` is
**PIPE-15**/**PIPE-16**'s fork semantics: a step that re-drives the downstream chain more than once (a redirect
following a hop, retry re-attempting, auth retrying after a 401 challenge) must invoke a *fresh* continuation each
time, resuming from the *same* position in the step array as its own invocation, never reusing an
already-invoked `next` handle. `koa-compose` treats calling `next()` twice as a bug and throws
`"next() called multiple times"` — the correct default for ordinary middleware, and the wrong default for a pillar
step whose entire job is controlled re-invocation. The port's composition function therefore exposes two distinct
capabilities to a step: a plain `next()` that enforces single-invocation (satisfying **PIPE-15**'s "reusing the
handle... MUST be treated as a defect" for every ordinary step), and an explicit `fork(): Next` available only to
steps occupying a pillar stage, which captures the calling step's position in the flattened array and returns a
*new*, independently-advancing continuation bound to that same starting position each time it is called — directly
implementing "a forked cursor MUST resume from the SAME position as its parent... forks advancing independently."

The **recovery-chain primitives** (§8.2 of the spec) map onto a TypeScript discriminated union, arguably a more
natural fit here than in Kotlin's `sealed class` modeling of the same two-variant sum type:

```
type Outcome<T> =
  | { readonly kind: 'success'; readonly value: T }
  | { readonly kind: 'failure'; readonly error: unknown }
```

`fold()` over this union gets compiler-checked exhaustiveness via a `never`-typed default branch, satisfying
**RECOV-1**'s "mutually exclusive and jointly exhaustive... a fold that applies exactly one of two branches at most
once per call" with no runtime discriminant logic beyond a `switch` on `kind`. The request-recovery chain
(**RECOV-3**) and response/recovery-step folds (**RECOV-4**–**RECOV-9**) are plain `async` reduce-style folds over
an ordered array of step functions; **RECOV-2**'s "every throwable from any step or the transport invocation MUST be
caught and converted to a Failure" is one `try`/`catch` wrapping the whole orchestrator dispatch, converting a thrown
value (which in JavaScript can legally be any value, not only an `Error`, another JS-specific wrinkle worth a single
footnote) into the `Failure` variant.

Because there is only one execution model (§3.2), **PIPE-28**'s "the async runtime MUST reuse identical stage
identities as the sync runtime; the two MUST NOT each re-derive ordering independently" is trivially, structurally
true: there is no second, synchronous pipeline whose ordering could drift from this one. **PIPE-33**/**PIPE-34**'s
sync-to-async and async-to-sync bridges have no Node counterpart to build, for the same reason — there is no
synchronous side to bridge from or to. This is the pipeline-layer instance of the same simplification argued in §3.2
for the transport seam, and it is real: two entire subsystems of bridge code the reference needs (§8.1's "Bridges"
subsection, **PIPE-33**–**PIPE-35**) simply do not exist in the port.

Response-lifecycle discipline across re-drives (**PIPE-40**: close every superseded intermediate response, never
close the one finally returned) maps onto `ReadableStream.cancel()` for an unread body and the SDK's own
`Response.close()` (which cancels the underlying stream and releases the transport's connection handle) for a body
that may have been partially read. A step that re-drives the chain via `fork()` is responsible for calling `close()`
on whatever response its own prior attempt produced before invoking the fork again, mirroring the reference's
placement of this responsibility on "a wrapping step that re-drives the chain," not on the pipeline runtime itself.

---

