## 7. Pagination, SSE, and Serialization

### 7.1 Pagination as async generators

**PAGE-1**'s two consumption views — item-level and page-level, over one lazy walk — map onto two `async function*`
generators sharing one internal drive routine, exposed to callers as `AsyncIterable<T>` (i.e., implementing
`Symbol.asyncIterator`, consumable via `for await...of`, the language's own native lazy-pull-iteration protocol).
Page-laziness (**PAGE-6**: zero exchanges until the consumer first probes for data) is not something the port has to
engineer — a generator function's body does not execute at all until its iterator's first `.next()` call, so
"constructing the paginator... triggers zero exchanges" is true by construction, not by careful bookkeeping.

Close-on-abandon (**PAGE-11**, **PAGE-12**) is the strongest example in this port of a spec requirement the host
language gives away for free where the reference had to build a bespoke mechanism. Kotlin's `Iterator`/`Sequence`
protocol has no built-in early-termination cleanup hook, which is exactly why the reference needs its own
`CloseablePages` wrapper type and an explicit "consumers must wrap the view in a scoped/auto-close construct"
convention. JavaScript's iterator protocol *does* have one: when a `for await...of` loop exits early — a `break`, a
`return`, or an exception propagating out of the loop body — the runtime automatically calls `.return()` on the
async iterator, which for a generator means resuming execution at whatever `finally` block currently encloses the
last executed `yield`. The port's item-level generator is therefore simply:

```
async function* items(): AsyncGenerator<Item> {
  for await (const page of pages()) {
    try { yield* page.items }
    finally { await page.close() }
  }
}
```

and an early `break` out of the consumer's `for await` loop drives the `finally` — and therefore `page.close()` —
automatically, with no wrapper type and no documented "must remember to close" convention required from callers.
The page-level view's two-outstanding-pages buffering (**PAGE-12**: a `hasNext()` probe eagerly runs the next
exchange, so an abandoned probe must not strand that prefetched page) is a one-slot look-ahead buffer held in the
generator's own closure, released the same way via `finally`.

**Verbatim query splice** (**PAGE-21**–**PAGE-24**) is the one place in this subsystem where the obvious
platform tool is the wrong tool. `URLSearchParams` exists natively and could plausibly rewrite a query parameter in
one line — but it re-serializes the *entire* query string through its own canonical encoding on every mutation,
which reorders and re-encodes untouched parameters (contrary to **PAGE-21**'s "every untargeted parameter is copied
byte-for-byte... order preserved") and encodes space as `+` rather than the RFC 3986 `%20` this port's query model
otherwise standardizes on (**HTTP-29**). The rewriter operates on the raw query substring directly — locating the
targeted parameter by hand-rolled tokenization, splicing only its value, and leaving every other byte of the query
string untouched — the same discipline the reference's own custom encoder already has to apply, for the identical
reason.

### 7.2 SSE as async generators, parsed by hand

The browser platform already ships a native `EventSource` implementing WHATWG SSE — and it is the wrong building
block for this SDK for three concrete reasons: it auto-reconnects (directly contrary to **SSE-38**'s "MUST NOT
auto-reconnect... reconnection... remains the caller's responsibility"), it is GET-only with no custom-header
support (incompatible with an SDK whose SSE streams typically ride behind an authenticated, possibly-non-GET
request), and it does not exist in Node at all without a polyfill package. `@dexpace/core` therefore hand-implements
the WHATWG line/field grammar (**SSE-1**–**SSE-19**) as a small synchronous state machine operating over the same
`BufferedSource` line-reading primitive from §3.1, exposed as an `AsyncGenerator<SseEvent>` — the identical
async-generator idiom §7.1 uses for pagination, and for the identical reason: `for await...of`'s automatic
`.return()`-on-abandon gives **SSE-25**'s "a partial consume MUST NOT strand the resource" the same way it gives
**PAGE-11**/**PAGE-12** their close-on-abandon guarantee, with the stream facade's `finally` block invoking
`response.body.cancel()` exactly once (**SSE-23**, **SSE-28**) regardless of which termination path — clean
end-of-stream, explicit break, or a mid-stream parse failure — triggered it. The typed adapter's Skip/Done/Value
outcomes (**SSE-33**–**SSE-36**) are a second, smaller instance of the same `Outcome`-shaped discriminated union
introduced in §5, reused rather than re-invented.

### 7.3 Serde: schema-as-witness instead of reflective type capture

**SERDE-5**–**SERDE-8** are stated as a defense against JVM generic erasure: a decoder given only an erased
`List<T>` cannot recover `T` at runtime, so the reference forces callers through an explicit runtime type token
(Jackson's `TypeReference<T>`, itself reconstructed via a reflective trick — subclassing to capture
`getGenericSuperclass()`). TypeScript's situation looks superficially similar — "TypeScript types vanish at
runtime" — but is actually a *different and, in one sense, more severe* problem: JVM generics erasure loses only the
*parameter* of a generic type; the raw class token (`Foo.class`) still exists and is still reflectively inspectable.
TypeScript erases *everything* — there is no runtime representation of a type at all, not even a raw class object,
unless the code explicitly constructs one. Reflection cannot recover what was never emitted; there is no
`getGenericSuperclass()`-style trick available, because there is no bytecode-level type metadata to reflect over in
the first place.

The concrete answer this design proposes is not to *recover* an erased type at runtime — that is not achievable in
TypeScript — but to require the caller to supply a **runtime value that already carries the same information a
reflective type token would have reconstructed**: a schema object. `@dexpace/core`'s `Deserializer<T>` seam takes,
in place of a type token, any value conforming to a minimal structural interface — `{ parse(input: unknown): T }` —
matching the shape shared today by Zod, Valibot, ArkType, and effect/schema, and increasingly formalized by the
community's emerging "Standard Schema" convention. `@dexpace/core` defines only that tiny structural interface; it
does not implement, bundle, or depend on any concrete schema library, preserving **SEAM-1**/**SEAM-19** exactly.
`@dexpace/codec-json` ships the glue: decode raw text via `JSON.parse`, then run the caller-supplied schema's
`parse()` over the resulting value.

This directly satisfies **SERDE-5**'s "explicit runtime type witness rather than erased/inferred generic" — the
schema value *is* the witness, and because TypeScript infers the decode function's static return type from the
schema's own generic parameter (`schema: StandardSchema<T>` yields `Promise<T>` from `deserialize(schema)`), the
compile-time type and the runtime witness are the same artifact, not two things kept in sync by convention. It also
gives a cleaner answer to **SERDE-6**'s parametric-target case (`List<Dto>`) than the reference's own mechanism:
Jackson's `TypeReference` for a parametric type still has to reconstruct a `java.lang.reflect.Type` graph at
runtime through reflection; a schema for an array of `Dto` is just `z.array(DtoSchema)` (or the equivalent in any
Standard-Schema-compatible library) — a combinator built from the element schema, supplied directly by the caller as
data, with no reflective reconstruction step needed anywhere, because nothing was ever erased that needs
reconstructing — the caller simply states the parametric structure once, as a value, and both the runtime witness
and the static type fall out of that one statement together. **SERDE-8**'s "reject construction with no type
argument or an unresolved type variable" has no equivalent failure mode to guard against in the port: since nothing
is ever inferred from an erased generic parameter at runtime, there is no "unresolved type variable erasing to its
bound" state reachable in the first place — the TypeScript compiler already refuses to accept a call site missing a
concrete schema value, which is a compile-time rejection, earlier and stronger than the reference's own
runtime-thrown guard.

**`Tristate<T>`** (**SERDE-14**–**SERDE-20**) is a three-branch discriminated union —
`{ kind: 'absent' } | { kind: 'null' } | { kind: 'present', value: T }` — with `Tristate.present()` constrained so a
`null` value cannot type-check as its argument (making the illegal fourth state unrepresentable at the type level,
not just by runtime validation, which is a strictly earlier catch than the reference's own construction-time
rejection). The tricky half of **SERDE-15** ("Absent MUST omit the key entirely; Null MUST emit the key with a wire
null") has a clean, built-in answer on the *encode* side: `JSON.stringify`'s second argument accepts a `replacer`
function invoked once per key, which may return `undefined` to have that key omitted from the output entirely —
exactly the mechanism this requirement needs, built into the language rather than requiring custom object-shape
massaging before serialization. `@dexpace/codec-json` installs a shared replacer recognizing `Tristate` values by a
branded tag and returning `undefined` for Absent, `null` for Null, and `.value` for Present. The *decode* side has no
equivalent built-in hook (a `JSON.parse` reviver runs bottom-up per key with no visibility into the enclosing DTO's
declared shape, so it cannot itself decide "this key was Tristate-typed"), which mirrors the reference's own
observation in **SERDE-17** that a missing key is short-circuited by the codec before any decoder-level null hook
runs — the port resolves it the same way the reference does, one layer up: the schema-based decode step from
earlier in this section interprets absent/null/present against a small `tristate(innerSchema)` combinator that
`@dexpace/codec-json` provides, rather than trying to make the raw JSON layer aware of Tristate at all.

---

