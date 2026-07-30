## 6. Retry, Redirect, and Authentication

**Single-sourcing** (the idempotent-method set of **HTTP-9**/**RETRY-6**, the retryable-status set of
**RETRY-1**/**XCUT-5**/**XCUT-7**, the shared backoff calculator of **RETRY-13**) is, if anything, easier to
guarantee correct in the port than in the reference: ES modules are singletons by default, so a single
`retryPolicy.ts` module exporting `IDEMPOTENT_METHODS`, `RETRYABLE_STATUSES`, and `computeDelay()` cannot silently
exist twice the way two JVM classloaders can each load their own copy of a class. Every consumer imports the same
frozen `Set`/function from the same module specifier; there is no second copy to drift.

The **backoff calculator** is a pure function taking the attempt number, a settings object
(`initialDelayMs`, `multiplier`, `maxDelayMs`, `jitter`), and an injectable random source (defaulting to
`Math.random`, overridable in tests the same way the spec's injectable clock seam, **CFG-15**, wants time
deterministically controllable) — satisfying **RETRY-9**–**RETRY-11** verbatim, including overflow-safe saturation
to the cap rather than throwing. The non-blocking inter-attempt wait (**RETRY-26**, "MUST NOT pin an execution
carrier") is close to a non-issue in Node — there are no carrier threads to pin — but the wait must still be
promptly cancellable (**XCUT-3**): implemented as a `Promise` racing a `setTimeout` against the same `AbortSignal`
used for the call's own cancellation (§3.2), clearing the timer on early abort so no dangling timer keeps the event
loop alive.

**Retry-After parsing** (**RETRY-15**–**RETRY-19**) cannot lean on `new Date(str)` for the RFC 1123 date variant:
JavaScript's `Date` constructor's string-parsing behavior is notoriously permissive and non-standardized across
engines (it accepts many non-conformant formats and its exact leniency differs between V8, JavaScriptCore, and
SpiderMonkey), which is the opposite of **RETRY-16**'s "MUST be total... malformed/negative/out-of-range values MUST
map to no hint, never a zero delay." The port hand-writes a small, strict RFC 1123 parser (mirroring the
reference's own **CFG-30**, which already has to special-case a lenient-but-bounded grammar rather than trust a
platform date parser) rather than risk `Date.parse`'s engine-dependent leniency silently accepting a malformed
header as a valid, wildly-wrong instant.

**One retry stack, not two.** The reference ships two cooperating retry stacks — the recovery-chain retry (with a
total-timeout budget, **RETRY-27**) and the stage-based retry step (without one, **RETRY-28**) — because it has two
pipeline layers with two different sync/async execution stories to serve. Since the port's pipeline layer is a
single execution model end to end (§5), it ships one retry step, and follows the spec's own explicit guidance for
this exact situation: "**RETRY-28**... a port that unifies retry entry points MUST make that total-timeout an
explicitly opt-in feature rather than always-on." The port's retry step therefore accepts an optional
`totalTimeoutMs` budget (undefined by default, matching **RETRY-27**'s "a zero budget disables the deadline"), with
per-attempt deadline shrinking applied only when that option is supplied.

**Body replayability and the race the port does not have.** **BODY-3**'s materialize-once guard needs a JVM
atomic compare-and-set because two threads could genuinely call `write()` on the same body concurrently. Node's
single-threaded event loop means two *synchronous* code paths can never interleave mid-statement — the entire class
of hazard **BODY-3** guards against with a CAS collapses, in the port, to "check-and-set a plain boolean flag before
the function's first `await`." This is a real, precise simplification, with one precise caveat worth stating rather
than glossing: the guard is only sound if the check-and-flip happens *before* the first `await` inside the guarded
`async` function — once execution has suspended at an `await`, another logical call can interleave on the same
event-loop turn, and a flag flipped only *after* an `await` reintroduces exactly the race the JVM reference needs an
atomic for. The port's materialize-once helper is written to flip its guard synchronously as the first statement of
the function, before any `await`, specifically to make this collapse valid.

**Redirect credential hygiene** (**REDIR-7**–**REDIR-13**) benefits from a genuinely better-behaved primitive than
the JVM reference had available: the WHATWG `URL` class (global, spec-identical across every JS runtime) never
performs DNS resolution to compare origins, unlike `java.net.URL`'s notorious `equals()`/`hashCode()`, which the
reference's own **HTTP-46** has to explicitly work around ("some platforms' native URL equality resolves the host —
blocking, and wrong for virtual hosts sharing an IP"). Cross-origin detection (**REDIR-8**: scheme, host, and
effective port compared against the *seed* origin) is `new URL(target).origin !== seedOrigin` after normalizing
default ports, with no blocking-call risk to design around in the first place.

**Digest authentication** (**AUTH-15**–**AUTH-22**) needs cryptographic primitives the reference draws from the
JVM's own standard library (`java.security.MessageDigest`, `SecureRandom`) — the same "standard library, not a
runtime dependency" reasoning applies to Node's built-in `node:crypto`, with one genuine complication worth being
precise about rather than hand-waving past. If `@dexpace/core` is to stay portable to browsers/Deno/Cloudflare
Workers (§3.1's whole premise), it should prefer the Web Crypto API (`globalThis.crypto.subtle`, universal across
those runtimes) over Node-specific `node:crypto` — but Web Crypto's `subtle.digest()` deliberately does not
implement MD5 (the algorithm is excluded from the standard on security grounds), while RFC 7616 Digest still
requires MD5/MD5-sess support for interoperability with servers that have not adopted SHA-256. The concrete answer:
`@dexpace/core` implements MD5 itself in a small, self-contained, dependency-free TypeScript module (the algorithm
is short and stable; several such implementations exist as public-domain reference code, none of them warrant an
npm dependency), and uses `crypto.subtle.digest('SHA-256', ...)` for the SHA-256/SHA-256-sess algorithms, which Web
Crypto does support natively. The cryptographically-strong client nonce (**AUTH-20**, ≥128 bits of entropy) uses
`crypto.getRandomValues()` (Web Crypto, universal) rather than `Math.random()`, exactly mirroring the reference's
requirement that it come from a CSPRNG, never a non-cryptographic RNG (**XCUT-21**).

---

