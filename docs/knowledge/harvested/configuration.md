# configuration

## Rules
- A value lookup must resolve in strict order — an explicit override for the exact key, then the environment source queried by the exact key name, then the system-property source queried by the normalized key name, then the caller-supplied default (which may be absent).
  <sub>spec · `docs/product-spec/16-configuration.md:7-7` · high · sha:367e27ec6481</sub>
- An environment value that is present but empty must be treated as absent, so the lookup falls through to the property layer.
  <sub>spec · `docs/product-spec/16-configuration.md:8-8` · high · sha:367e27ec6481</sub>
- The property layer must be queried under a normalized key derived by lowercasing and replacing every underscore with a dot (e.g. MAX_RETRY_ATTEMPTS becomes max.retry.attempts), while the override and environment layers use the original name.
  <sub>spec · `docs/product-spec/16-configuration.md:9-9` · high · sha:367e27ec6481</sub>
- A separate raw property accessor must look up by the exact name, without env-to-property normalization, so camelCase property-only keys (e.g. https.proxyHost) resolve with casing preserved.
  <sub>spec · `docs/product-spec/16-configuration.md:10-10` · high · sha:367e27ec6481</sub>
- The typed accessors (integer, boolean, duration) must resolve the raw value through the same layered lookup as the string accessor before parsing, must not read only the override map or skip the env/property layers, and the typed default applies only when the layered lookup yields no value.
  <sub>spec · `docs/product-spec/16-configuration.md:11-11` · high · sha:367e27ec6481</sub>
- Typed accessors must not throw on missing or unparseable values — the integer accessor returns the default when absent or not a valid integer, the duration accessor returns the default on any parse failure, and negative integers are valid and returned as-is.
  <sub>spec · `docs/product-spec/16-configuration.md:15-15` · high · sha:367e27ec6481</sub>
- The boolean accessor must be strict, recognizing only case-insensitive "true"/"false"; anything else (1, 0, yes, no, on, off) falls through to the default.
  <sub>spec · `docs/product-spec/16-configuration.md:16-16` · high · sha:367e27ec6481</sub>
- The duration accessor must accept ISO-8601 durations (leading P/p), shorthand <number><unit> (units ms, s, m, h, d, case-insensitive), and a bare number interpreted as milliseconds; a negative duration or an unknown unit must return the default.
  <sub>spec · `docs/product-spec/16-configuration.md:17-17` · high · sha:367e27ec6481</sub>
- A built configuration must be immutable and safe to share without external synchronization, with the override map defensively copied at build time so later builder mutation cannot alter a built instance.
  <sub>spec · `docs/product-spec/16-configuration.md:21-21` · high · sha:367e27ec6481</sub>
- Deriving a reconfigured configuration must be copy-on-write, producing a new instance with the mutator applied while leaving the receiver unchanged; the override map must be copied before the mutator runs, and the environment/property source seams are inherited by reference unless the mutator replaces them.
  <sub>spec · `docs/product-spec/16-configuration.md:22-22` · high · sha:367e27ec6481</sub>
- Removing an override must drop only the override layer so a subsequent lookup falls through to env/property/default as if the override never existed; removal must not force the key to resolve to null, and removing a key with no override must be a no-op.
  <sub>spec · `docs/product-spec/16-configuration.md:23-23` · high · sha:367e27ec6481</sub>
- The environment and property sources must be substitutable seams (injectable functions from key name to optional string) so tests supply hermetic lookups, and production defaults must delegate to the platform environment and system properties.
  <sub>spec · `docs/product-spec/16-configuration.md:24-24` · high · sha:367e27ec6481</sub>
- Configuration builders should be usable single-threaded only; the immutability guarantee applies to the built configuration, not an in-progress builder.
  <sub>spec · `docs/product-spec/16-configuration.md:25-25` · high · sha:367e27ec6481</sub>
- A process-wide global configuration slot should be provided with last-write-wins replacement and safe publication, defaulting to an empty configuration.
  <sub>spec · `docs/product-spec/16-configuration.md:26-26` · high · sha:367e27ec6481</sub>
- Passing a null/absent required argument to a mutating configuration operation (override key or value, source function, derive mutator, global-config setter) must fail fast rather than storing a null, though documented-nullable optional slots (proxy credentials, challenge handler, lookup default) may be null, and a language without null-safety must add explicit validation.
  <sub>spec · `docs/product-spec/16-configuration.md:28-28` · high · sha:367e27ec6481</sub>
- The time abstraction must be an injectable seam exposing three operations — current wall-clock instant, a monotonic elapsed-time counter, and a blocking interruptible sleep — with a shared platform-backed default provided, and time-dependent logic should route through this seam so tests can drive time deterministically.
  <sub>spec · `docs/product-spec/16-configuration.md:32-32` · high · sha:367e27ec6481</sub>
- The monotonic counter must be non-decreasing and used only for measuring elapsed durations between its own readings (its absolute value is not meaningful), while the wall-clock reading may move backwards and must not be used for elapsed-time measurement.
  <sub>spec · `docs/product-spec/16-configuration.md:33-33` · high · sha:367e27ec6481</sub>
- sleep must reject a negative duration, must allow a zero duration (returning promptly), and must honor cooperative cancellation by re-asserting the interrupt/cancellation status before propagating when interrupted mid-sleep.
  <sub>spec · `docs/product-spec/16-configuration.md:34-34` · high · sha:367e27ec6481</sub>
- The async layer should provide a scheduled non-blocking delay yielding a future that completes after a non-negative duration on a scheduler without blocking a thread; zero completes immediately, negative is rejected, and cancelling the future must cancel the underlying scheduled task.
  <sub>spec · `docs/product-spec/16-configuration.md:35-35` · high · sha:367e27ec6481</sub>
- When surfacing the cause of a failed async operation, the subsystem should unwrap the platform's async-completion wrapper exceptions to the original throwable, terminating on the first non-wrapper, a null cause, or a detected cycle.
  <sub>spec · `docs/product-spec/16-configuration.md:36-36` · high · sha:367e27ec6481</sub>
- The subsystem should provide an interruptible-task future running a task on an executor such that cancel-with-interrupt interrupts the running worker while cancel-without does not; a queued or finished task must not be interrupted, the worker's interrupt state must be cleared before it returns to its pool, and rejected submission must be delivered through the future, never thrown synchronously.
  <sub>spec · `docs/product-spec/16-configuration.md:37-37` · high · sha:367e27ec6481</sub>
- When an interruptible-task future has already been cancelled and the task nonetheless produced a closeable result, that result must be closed on the discard path (best-effort, swallowing close failures), and the close helper must be null-safe.
  <sub>spec · `docs/product-spec/16-configuration.md:38-38` · high · sha:367e27ec6481</sub>
- The proxy model must be immutable and carry the proxy type (HTTP, SOCKS4, SOCKS5), socket address, an ordered list of non-proxy host glob patterns, optional credentials, an optional challenge-handler slot, and an explicit bypass-all flag, and its string rendering must mask credentials.
  <sub>spec · `docs/product-spec/16-configuration.md:42-42` · high · sha:367e27ec6481</sub>
- The host-bypass decision must short-circuit to true when bypass-all is set, otherwise returning true iff the host matches any configured glob; glob conversion must treat * as "any run", ? as "one character", escape regex metacharacters, require a full-string match, and match case-insensitively, and patterns should be compiled once at construction.
  <sub>spec · `docs/product-spec/16-configuration.md:43-43` · high · sha:367e27ec6481</sub>
- Resolving proxy options from configuration must follow a fixed precedence and must not throw on malformed input (returning null with a warning instead): system properties first (host preferring https.proxyHost over http.proxyHost, port from the same layer as the chosen host, credentials read only from https.proxyUser/https.proxyPassword with no http.* fallback), otherwise the env URL HTTPS_PROXY preferred over HTTP_PROXY parsed as scheme://user:pass@host:port; if no proxy is configured or config is invalid, resolution returns null.
  <sub>spec · `docs/product-spec/16-configuration.md:44-44` · high · sha:367e27ec6481</sub>
- The proxy port must be explicit and within 0..65535; a missing, non-numeric, or out-of-range port must yield null with no default-port guessing, and an absent port in a proxy URL must be treated as invalid.
  <sub>spec · `docs/product-spec/16-configuration.md:45-45` · high · sha:367e27ec6481</sub>
- The non-proxy host list must be resolved with the system property (pipe-separated) winning over the environment variable (comma-separated), both must honor a backslash escape preceding the literal separator and must trim tokens, and the observable order is split, drop empty, unescape, trim, so a whitespace-only fragment is retained as an empty token.
  <sub>spec · `docs/product-spec/16-configuration.md:46-46` · high · sha:367e27ec6481</sub>
- When the resolved non-proxy configuration is exactly a single bare "*", it must be interpreted as bypass-all (resolution returns null so the caller routes directly), represented by the explicit bypass-all flag rather than as a literal "*" entry, while a "*" inside a multi-entry list is a normal any-host glob.
  <sub>spec · `docs/product-spec/16-configuration.md:47-47` · high · sha:367e27ec6481</sub>
- A convenience resolver may read proxy options from the global configuration, but the environment must be consulted only when a resolver is explicitly invoked — nothing may read proxy configuration implicitly at startup.
  <sub>spec · `docs/product-spec/16-configuration.md:48-48` · high · sha:367e27ec6481</sub>
- RFC 1123 date formatting must emit the canonical HTTP-date form with a zero-padded two-digit day-of-month and a literal "GMT", rendered in UTC (e.g. "Sun, 06 Nov 1994 08:49:37 GMT").
  <sub>spec · `docs/product-spec/16-configuration.md:52-52` · high · sha:367e27ec6481</sub>
- RFC 1123 date parsing must be tolerant: month names case-insensitive, the zone token accepts GMT, UTC, +0000, +00:00 (all normalized to zero offset), and the leading weekday token is informational only and must not be validated against the date (it is stripped, not parsed).
  <sub>spec · `docs/product-spec/16-configuration.md:53-53` · high · sha:367e27ec6481</sub>
- RFC 1123 parsing must be strict on the day-of-month-onward grammar: blank input must fail, and a form missing the comma after the weekday must fail.
  <sub>spec · `docs/product-spec/16-configuration.md:54-54` · high · sha:367e27ec6481</sub>
- The non-blocking UUID generator must produce type-4 UUIDs with correct RFC 4122 layout (version 4, IETF variant), must be usable concurrently without shared mutable state, must use a non-blocking (per-thread) PRNG, and callers must treat the output as non-cryptographic.
  <sub>spec · `docs/product-spec/16-configuration.md:55-55` · high · sha:367e27ec6481</sub>
- Deep value-equality helpers must compare by content — arrays element-by-element (object arrays recursing for nested/multi-dimensional arrays, primitive arrays comparing by element value) and non-arrays falling back to ordinary equality — and both helpers must be null-safe (two nulls equal, null hashes to zero) with equals and hashCode mutually consistent.
  <sub>spec · `docs/product-spec/16-configuration.md:56-56` · high · sha:367e27ec6481</sub>
- Deep equality must follow floating-point array semantics where NaN equals NaN and +0.0 does not equal -0.0 (for primitive and boxed float/double arrays), with hashing matching, and an object array must not be equal to a primitive array of the same numeric values.
  <sub>spec · `docs/product-spec/16-configuration.md:57-57` · high · sha:367e27ec6481</sub>

## Constraints

## Conclusions
- Configuration layering collapses from the reference's four tiers (override, environment, system property, default) to three tiers (override, environment, default), because Node has no ambient, JVM-style key/value store distinct from environment variables.
  <sub>design · `docs/sdk-design-nodejs/08-instrumentation-and-configuration.md:24-27` · high · sha:35281a426195</sub>
- The port deliberately does not fabricate a fake middle configuration tier by routing a synthetic "system property" through `process.env` under a different key, since that would just be a second environment lookup wearing a different name, adding complexity without adding a genuinely distinct source.
  <sub>design · `docs/sdk-design-nodejs/08-instrumentation-and-configuration.md:27-30` · high · sha:35281a426195</sub>
- Applications wanting a `.env`-file-driven configuration layer must load `dotenv` (or equivalent) at their own bootstrap before the SDK reads `process.env`; that convention lives entirely outside `@dexpace/core`, which stays unaware that `.env` files exist.
  <sub>design · `docs/sdk-design-nodejs/08-instrumentation-and-configuration.md:30-33` · high · sha:35281a426195</sub>
- The ISO-8601 duration grammar for the never-throw typed configuration accessors is hand-rolled because JavaScript has no built-in duration parser equivalent to Java's `java.time.Duration.parse`, and the requirement is total (never throw), so a hand-written parser with an explicit failure-to-default fallback is the only option.
  <sub>design · `docs/sdk-design-nodejs/08-instrumentation-and-configuration.md:35-39` · high · sha:35281a426195</sub>
- The `Clock` seam's elapsed-time primitive uses `globalThis.performance.now()`, chosen over the Node-specific `process.hrtime.bigint()` for cross-runtime portability across Node, browsers, Deno, Bun, and Cloudflare Workers.
  <sub>design · `docs/sdk-design-nodejs/08-instrumentation-and-configuration.md:41-44` · high · sha:35281a426195</sub>
- The proxy model resolves `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` from the environment only, since Node has no system-properties layer to prefer first, representing a second instance of the same three-tier-to-two-tier configuration collapse.
  <sub>design · `docs/sdk-design-nodejs/08-instrumentation-and-configuration.md:46-49` · high · sha:35281a426195</sub>

## Reference
- The layered configuration model resolves string-keyed values through a fixed precedence chain and derives reconfigured instances copy-on-write, and the porting goal is behavioral parity — same precedence, same never-throw lookup, same immutability, and the same substitutable env/property/time seams so conformance tests run hermetically.
  <sub>spec · `docs/product-spec/16-configuration.md:3-3` · high · sha:367e27ec6481</sub>
- The subsystem should expose stable well-known key constants for the retry-attempt cap, log level, and standard proxy variables (HTTP_PROXY, HTTPS_PROXY, NO_PROXY).
  <sub>spec · `docs/product-spec/16-configuration.md:27-27` · high · sha:367e27ec6481</sub>
- A copy-on-write derive produces a reconfigured configuration from an existing one by applying a mutator to a prefilled builder while leaving the receiver unchanged, copying the override map up front while sharing pure read seams by reference.
  <sub>spec · `docs/product-spec/appendix-a-glossary.md:17` · high · sha:f0b3d2058626</sub>
- The configuration conformance suite verifies four-layer precedence, override > env > normalized-property > default (CFG-1); empty environment values treated as absent (CFG-2); property key normalization (CFG-3); a raw property accessor without normalization (CFG-4); and typed accessors resolving through the full layered lookup (CFG-38).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:50` · high · sha:0451cc7f3bb4</sub>
- The configuration conformance suite verifies never-throw int/duration accessors with negatives valid (CFG-5), strict boolean parsing accepting only true/false (CFG-6), and duration parsing accepting ISO format, shorthand, and bare-number-milliseconds while rejecting negatives (CFG-7).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:51` · high · sha:0451cc7f3bb4</sub>
- The configuration conformance suite verifies the built config is immutable with the override map copied at build (CFG-8), copy-on-write derive shares source seams (CFG-9), remove drops only the override layer (CFG-10), env/property seams are substitutable (CFG-11), the builder is single-threaded (CFG-12), a global slot is last-write-wins (CFG-13), well-known key constants exist (CFG-14), and a null required argument is rejected (CFG-37).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:52` · high · sha:0451cc7f3bb4</sub>
- The configuration conformance suite verifies a clock seam (now/monotonic/interruptible sleep) with a shared default (CFG-15), monotonic time non-decreasing with wall-clock not used for elapsed time (CFG-16), sleep rejects negative durations and honors cancellation by re-asserting the flag (CFG-17), a non-blocking scheduled delay cancels its task (CFG-18), async-wrapper unwrapping is cycle-safe (CFG-19), an interruptible task future has clean interrupt state (CFG-20), and an orphaned closeable result is closed on discard (CFG-21).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:53` · high · sha:0451cc7f3bb4</sub>
- The configuration conformance suite verifies an immutable credential-masking proxy model (CFG-22), glob bypass matching is full-string case-insensitive (CFG-23), proxy resolution precedence never throws with host/port from the same layer and https-only credentials (CFG-24), an explicit in-range port or null (CFG-25), non-proxy list precedence and escape handling (CFG-26), a single bare `*` bypasses all (CFG-27), and environment resolution is opt-in (CFG-28).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:54` · high · sha:0451cc7f3bb4</sub>
- The configuration conformance suite verifies RFC 1123 canonical date formatting (CFG-29) and tolerant parsing with informational weekday and zone aliases while strict on the rest (CFG-30/CFG-31), a non-blocking non-cryptographic type-4 UUID (CFG-32), deep value equality that is content-based and null-safe (CFG-33) with NaN/signed-zero and kind-distinct array semantics (CFG-34), a shared retryability classifier where implemented (CFG-35), and a build/runtime descriptor with a non-blank `unknown` fallback (CFG-36).
  <sub>spec · `docs/product-spec/appendix-b-conformance-test-checklist.md:55` · high · sha:0451cc7f3bb4</sub>
- A Node-specific SDK extension may substitute `process.hrtime` for the Clock seam where sub-millisecond precision genuinely matters and portability to non-Node runtimes is not a goal for that particular build.
  <sub>design · `docs/sdk-design-nodejs/08-instrumentation-and-configuration.md:44-46` · high · sha:35281a426195</sub>

## Conflicts

## Superseded
