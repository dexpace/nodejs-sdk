## 8. Instrumentation and Configuration

The logging facade (§3.5) is `Logger`/`LogEvent` structural interfaces with one shared, allocation-minimal no-op
default installed process-wide until a consumer supplies a real one — satisfying **OBS-1**'s "disabled path
allocates nothing" as a single frozen object whose methods all return `this` and whose terminal `emit()` is a no-op,
identical in spirit to the reference's own no-op tracer/meter defaults (**OBS-25**, **OBS-31**). `@dexpace/logging-
pino` and `@dexpace/logging-debug` are the two reference bridges, chosen because they represent the two poles of
the Node logging ecosystem worth supporting explicitly: `pino` is the dominant high-throughput structured-JSON
logger (a natural fit for this SDK's field/structured-event model), and `debug` is the zero-configuration
"just works for a library" option most Node engineers already have wired into their terminal output — the closest
Node analog to "implement SLF4J, hand it to whichever backend the application already runs."

For **W3C Trace Context** (**OBS-26**/**OBS-27**), the port makes a deliberate ecosystem-fit choice the JVM
reference did not have available: rather than inventing a bespoke `Tracer`/`Span` interface from scratch, the
`Tracer`/`Span` seam is defined as a structural subset of `@opentelemetry/api`'s own `Tracer`/`Span` shapes. Node's
tracing ecosystem has, unlike the JVM's, largely converged on one dominant API (`@opentelemetry/api`), so an
application already running OpenTelemetry auto-instrumentation gets this SDK's HTTP spans wired in with zero
adapter code — pure duck-typing compatibility, no dependency added to `@dexpace/core` — while an application with no
tracer installed still gets the same no-op default **OBS-25** requires. Redaction (**OBS-11**–**OBS-19**) is
implemented directly against the global `URL` class — userinfo stripping, allow-listed query-parameter redaction
via `url.searchParams`, and manual fragment-token redaction (since `URL` does not parse `key=value` tokens out of
`url.hash`, that half is hand-rolled the same way the reference's own fragment handling is, per **OBS-13**).

**Configuration layering** (**CFG-1**) specifies four tiers: an explicit override, the environment, the *system
property* layer (queried under a normalized dotted-lowercase key), and a default. Node has no system-properties
analog — there is no ambient, JVM-style key/value store distinct from environment variables — so the port's
layering genuinely collapses to three tiers: override, environment, default. This is stated plainly as a platform
difference, not smoothed over by inventing a fake middle tier (e.g., routing a fabricated "system property" through
`process.env` under a different key would just be a second environment lookup wearing a different name, adding
complexity without adding a genuinely distinct source). Applications wanting a `.env`-file-driven layer get it by
loading `dotenv` (or equivalent) at their own bootstrap, before the SDK ever reads `process.env` — that convention
lives entirely outside `@dexpace/core`, which stays unaware that `.env` files exist, the same way the JVM reference
stays unaware of any particular properties-file-loading convention beyond the bare `System.getProperty` seam.

The never-throw typed accessors (**CFG-5**–**CFG-7**) are pure functions with the same tolerant-parsing rules
translated directly — the ISO-8601 duration grammar has no built-in JS parser (unlike Java's
`java.time.Duration.parse`), so it is hand-rolled the same way the Retry-After date grammar in §6 is, for the
identical reason: no platform primitive to trust, and the requirement is total (never throw), so a hand-written
parser with an explicit failure-to-default fallback is the only option regardless.

Node's `globalThis.performance.now()` — spec-guaranteed monotonic, available identically across Node, browsers,
Deno, Bun, and Cloudflare Workers — is the `Clock` seam's elapsed-time primitive (**CFG-16**), chosen over the
Node-specific, higher-resolution `process.hrtime.bigint()` for the same cross-runtime-portability reason Web Streams
were chosen over Node streams in §3.1; a Node-specific extension may substitute `process.hrtime` where
sub-millisecond precision genuinely matters and portability to non-Node runtimes is not a goal for that particular
build. The proxy model (**CFG-22**–**CFG-28**) resolves `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` from the environment
only — Node has no system-properties layer to prefer first the way `CFG-24` prefers `https.proxyHost` over an
environment URL, so this is a second, smaller instance of the same three-tier-to-two-tier collapse already stated
for configuration generally, not a new deviation.

---

