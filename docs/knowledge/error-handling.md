# error-handling

## Rules
- Domain failures must be modeled as typed `Error` subclasses forming a root class (e.g. `PaymentError`) with specific leaf subclasses, rather than throwing a bare `new Error(...)`.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/08-error-handling.md:53-59` · high · sha:2424e16b0906</sub>
- Error subclasses must carry the identifying inputs (ids, offending input, correlation id) as `readonly` fields so they survive serialization and appear in structured logs.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/08-error-handling.md:58-58` · high · sha:2424e16b0906</sub>
- The base error constructor must set `this.name = new.target.name` so every subclass reports its own class name in stack traces without restating it.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/08-error-handling.md:59-59` · high · sha:2424e16b0906</sub>
- Error hierarchies must be kept to two levels deep; a five-level error hierarchy navigates no better than a two-level one.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/08-error-handling.md:59-59` · high · sha:2424e16b0906</sub>
- Every wrap-and-rethrow of a caught error must pass the original as `{ cause }` (ES2022 `Error` second argument) so the failure chain is not lost.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/08-error-handling.md:75-90` · high · sha:2424e16b0906</sub>
- The value passed as `cause` must first be normalized to an `Error` via `toError`, since a rethrow's `cause` must itself be an `Error`.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/08-error-handling.md:80-80` · high · sha:2424e16b0906</sub>
- A shared `toError` helper must be defined once and imported everywhere to narrow a caught `unknown` into an `Error`, and it must never itself throw from inside a `catch`.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/08-error-handling.md:96-106` · high · sha:2424e16b0906</sub>
- The `toError` helper must guard its stringify step because `String(e)` itself can throw on a null-prototype object or a value whose `toString`/`Symbol.toPrimitive` throws.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/08-error-handling.md:96-105` · high · sha:2424e16b0906</sub>
- Richer narrowing of a caught error to a specific type must use `instanceof` against the specific class, never duck-typing on `.message` or a string `.code`.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/08-error-handling.md:107-116` · high · sha:2424e16b0906</sub>
- A `catch` block must end in exactly one of three ways: handle the failure and recover to a known-good state, wrap-and-rethrow with `cause`, or not catch at all; "log and continue" is none of these.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/08-error-handling.md:120-124` · high · sha:2424e16b0906</sub>
- A deliberate ignored error (a best-effort cleanup that may legitimately fail) must be narrowed to the one expected error type and carry a comment explaining why the failure is tolerable.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/08-error-handling.md:125-137` · high · sha:2424e16b0906</sub>
- Each layer must translate the failure of the layer below into its own vocabulary and wrap it with `cause`, so lower-level errors (e.g. an ORM error) never surface in domain logic.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/08-error-handling.md:141-144` · high · sha:2424e16b0906</sub>
- Only the outermost boundary (HTTP handler, queue consumer, CLI entry) logs an error, doing so once with the full `cause` chain and the correlation id; inner layers add context but do not log.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/08-error-handling.md:145-146` · high · sha:2424e16b0906</sub>
- A `Result<T, E>` union should be used opt-in per module where failure is expected and part of the contract, defined once as a frozen type with an `ok` discriminant.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/08-error-handling.md:162-173` · high · sha:2424e16b0906</sub>
- A module must either throw or return `Result`, never both; mixing the two forces the caller to narrow the union and wrap a `try` around it.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/08-error-handling.md:175-175` · high · sha:2424e16b0906</sub>
- The transition between a throwing style and a `Result` style must happen only at a module boundary: a throwing dependency is converted to `Result` at the adapter that calls it, and a `Result` is unwrapped or rethrown at the edge of the module that produced it.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/08-error-handling.md:176-176` · high · sha:2424e16b0906</sub>
- A programmer error (a violated precondition, an unreachable branch reached, an impossible state) must crash loudly close to the fault via `invariant` or `assertNever`, and must never be demoted to a handled error.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/08-error-handling.md:196-198` · high · sha:2424e16b0906</sub>
- An operational error (an expected failure of a correct program, such as a declined card, timeout, or missing file) must be handled as a typed `Error` or a `Result`.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/08-error-handling.md:197-197` · high · sha:2424e16b0906</sub>
- Error messages must include the identifying inputs the reader cannot otherwise see, not just the symptom, since a message is a public API that travels into logs, stack traces, and alerting.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/08-error-handling.md:210-213` · high · sha:2424e16b0906</sub>
- Error messages must never interpolate secrets — tokens, credentials, API keys, full PANs, or raw PII — and must mask to the minimum identifying fragment (e.g. `card ****1234`).
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/08-error-handling.md:214-214` · high · sha:2424e16b0906</sub>
- Structured identifying fields belong on the error object itself, not only embedded in the message string, so a log aggregator can index them without parsing prose.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/08-error-handling.md:215-215` · high · sha:2424e16b0906</sub>
- Exceptions must not be used for control flow; an ordinary "not found" or "no" result must not be signaled via `throw`/`catch`.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/08-error-handling.md:226-229` · high · sha:2424e16b0906</sub>
- Absence must be represented as `T | undefined` from a may-miss lookup, narrowed by the caller with `?.`/`??`, rather than thrown as an error.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/08-error-handling.md:230-230` · high · sha:2424e16b0906</sub>
- A yes/no question must return a `boolean` (e.g. `hasAccess(user): boolean`) rather than throwing an error the caller must wrap in `try` to interpret as a predicate.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/08-error-handling.md:231-231` · high · sha:2424e16b0906</sub>
- Every public API must document its failure modes via a `@throws` TSDoc tag per catchable error type, or by returning a `Result` type that puts the failures in the signature itself.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/08-error-handling.md:242-247` · high · sha:2424e16b0906</sub>
- A `@throws` tag must list only the errors a caller would reasonably act on, not every `Error` that could theoretically escape, and must be kept in step with the implementation since a new throw is a contract change.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/08-error-handling.md:247-247` · high · sha:2424e16b0906</sub>
- Fan-out over N independent operations must run via `Promise.allSettled` (not `Promise.all`, which rejects on the first failure and abandons the rest) so all failures are collected.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/08-error-handling.md:260-264` · high · sha:2424e16b0906</sub>
- If any fan-out operations fail, a single `AggregateError` must be thrown holding every cause, with a message stating how many of how many operations failed.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/08-error-handling.md:265-273` · high · sha:2424e16b0906</sub>
- The error taxonomy must have exactly two top-level branches, protocol errors carrying a fully-received response raised as an unchecked/runtime error and transport errors carrying no response belonging to the runtime's I/O-error family, with transport errors always reporting themselves retryable at the error level.
  <sub>spec · `docs/product-spec/19-cross-cutting-invariants-and-policies.md:15` · high · sha:d6123be82c9e</sub>
- The baked retryability flag of a protocol error must be computed once at construction from a single shared status classifier that treats 408, 429, and all 5xx statuses except 501 and 505 as retryable and everything else as not retryable.
  <sub>spec · `docs/product-spec/19-cross-cutting-invariants-and-policies.md:16` · high · sha:d6123be82c9e</sub>
- A transport-family or custom error type that declares itself retryable via a retryability capability must participate in retry decisions without any edit to the classifier, which queries the capability rather than matching a concrete type.
  <sub>spec · `docs/product-spec/19-cross-cutting-invariants-and-policies.md:17` · high · sha:d6123be82c9e</sub>
- For a protocol error, retry eligibility must be decided by a configurable retryable-status set (default `{408, 429, 500, 502, 503, 504}`) that is authoritative over the baked retryability flag and also governs whether a freshly re-sent error-status response is re-classified as a failure for the next attempt.
  <sub>spec · `docs/product-spec/19-cross-cutting-invariants-and-policies.md:18` · high · sha:d6123be82c9e</sub>
- The status-to-exception mapping factory must reject being asked to map a non-error status (1xx/2xx/3xx) by raising an argument error, though a convenience form may instead return an absent/null value for non-error statuses.
  <sub>spec · `docs/product-spec/19-cross-cutting-invariants-and-policies.md:19` · high · sha:d6123be82c9e</sub>
- Any classification logic that walks an error's cause chain must be cycle-safe, tracking visited causes by reference identity and terminating on a self-referential or cyclic chain.
  <sub>spec · `docs/product-spec/19-cross-cutting-invariants-and-policies.md:20` · high · sha:d6123be82c9e</sub>

## Constraints
- TypeScript types a `catch` binding as `unknown` under `useUnknownInCatchVariables` (on in strict mode), so treating a caught value as `Error` without narrowing is unsound.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/08-error-handling.md:92-95` · high · sha:2424e16b0906</sub>

## Conclusions
- A `Result` signature is preferred over `@throws` documentation where it fits, because it cannot drift from the implementation the way a comment can.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/08-error-handling.md:247-247` · high · sha:2424e16b0906</sub>

## Reference
- `Object.freeze` on a `Result` value is shallow, so it locks the wrapper's `ok`/`value`/`error` slots while the payload's own immutability remains a separate concern.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/08-error-handling.md:165-165` · high · sha:2424e16b0906</sub>
- The `Result` discipline in this chapter ports the Python style guide's §8.11 Result discipline.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/08-error-handling.md:176-176` · high · sha:2424e16b0906</sub>
- A may-miss lookup function is named `get<Noun>(): T | undefined`, while an asserting variant keeps the same verb but throws when the value is absent.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/08-error-handling.md:230-230` · high · sha:2424e16b0906</sub>
- A protocol error's baked retryability flag and the retry step's configurable retryable-status gate are distinct notions with distinct default membership, and the retry step actually consults the configured set rather than the baked flag.
  <sub>spec · `docs/product-spec/19-cross-cutting-invariants-and-policies.md:5` · high · sha:d6123be82c9e</sub>
- A protocol error means a complete response was received but its status is 4xx/5xx, represented as an unchecked/runtime error carrying the response.
  <sub>spec · `docs/product-spec/appendix-a-glossary.md:47` · high · sha:f0b3d2058626</sub>
- Retryability is whether a failure condition is transient, decided for a protocol error by the configured retryable-status set at the retry step and, for a transport error, always transient.
  <sub>spec · `docs/product-spec/appendix-a-glossary.md:57` · high · sha:f0b3d2058626</sub>
- A transport error is a failure that produced no response (connect refused, DNS/TLS failure, read timeout, peer reset), belonging to the runtime's I/O-error family and always-retryable at the error level.
  <sub>spec · `docs/product-spec/appendix-a-glossary.md:65` · high · sha:f0b3d2058626</sub>

## Conflicts

## Superseded
