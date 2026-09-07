# performance

## Rules
- The slowest resource must be optimized first, following the fixed order network > disk > memory > CPU, confirmed by a profile before code is touched.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/15-performance.md:38-43` · high · sha:fda79c6bd580</sub>
- A CPU micro-fix proposed before a profile has named CPU as the bottleneck is sent back in design review.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/15-performance.md:45-45` · high · sha:fda79c6bd580</sub>
- Objects must be constructed with the same properties in the same order every time, with every field initialized in one place (the literal or constructor) rather than added later, to avoid forking the hidden class into a transition chain.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/15-performance.md:51-52` · high · sha:fda79c6bd580</sub>
- Monomorphism must be confirmed via a `--cpu-prof` capture when it matters, never asserted merely from reading the source.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/15-performance.md:61-61` · high · sha:fda79c6bd580</sub>
- To clear a value while keeping the object's shape, assign `undefined` to the field instead of using `delete`; if a genuinely smaller object is needed, build a fresh one with exactly the required fields.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/15-performance.md:67-67` · high · sha:fda79c6bd580</sub>
- Arrays must be kept dense — via `push` or by pre-sizing and filling every slot — because sparse arrays (e.g. `arr[1000] = x` on a short array, or `delete arr[3]`) abandon V8's packed-elements representation for a dictionary store and slow indexing for the array's whole life.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/15-performance.md:63-68` · high · sha:fda79c6bd580</sub>
- Allocations (objects, arrays, closures) must be kept out of hot paths because the performance cost of an allocation is the rate at which it repeats, not the cost of a single instance.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/15-performance.md:78-82` · high · sha:fda79c6bd580</sub>
- To remove hot-path allocations, hoist the allocation out of the loop, restructure chained pipeline methods into a single `for...of` pass, reuse a pre-sized output buffer, and prefer `Map`/`Set` and typed arrays where the shape allows.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/15-performance.md:83-83` · high · sha:fda79c6bd580</sub>
- Cold paths should not be pre-optimized for allocations, since V8's generational garbage collector makes short-lived garbage cheap and clear pipeline code beats a micro-saved allocation wherever a profile is flat.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/15-performance.md:83-83` · high · sha:fda79c6bd580</sub>
- `await` inside a loop must not serialize independent iterations; independent awaits should be collected as promises and run together with `Promise.all`.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/15-performance.md:95-99` · high · sha:fda79c6bd580</sub>
- A performance fix must be justified by a captured profile showing the problem before and after; a fix without a measured delta is treated as a rumor.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/15-performance.md:111-114` · high · sha:fda79c6bd580</sub>
- Micro-comparisons should use `mitata`, with its caveats stated every time it is cited: it measures a function in isolation with a warm JIT, flattering code the optimizing compiler treats kindly while ignoring deopts a real call site would trigger.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/15-performance.md:116-116` · high · sha:fda79c6bd580</sub>
- Order-of-magnitude gaps in benchmark results are trustworthy while roughly 10% deltas should be treated as noise due to warm-up and variance.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/15-performance.md:116-116` · high · sha:fda79c6bd580</sub>
- Benchmarks must be committed in the repository beside the code they guard, as a `*.bench.ts` file that turns a one-time speed claim into a regression test.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/15-performance.md:116-116` · high · sha:fda79c6bd580</sub>
- A pull request claiming a performance win must attach before/after profile numbers in the description; a deliberate optimization without a committed benchmark or a captured profile does not merge.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/15-performance.md:124-124` · high · sha:fda79c6bd580</sub>
- `Array.join` should be reached for only when an array of parts is already held, not as a default concatenation reflex.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/15-performance.md:130-130` · high · sha:fda79c6bd580</sub>
- Template literals are the default string-building choice for readability since `${a}${b}` and `a + b` compile to the same shape in V8; a claim that either `+=` or `join` is faster on a hot path must cite a `mitata` result.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/15-performance.md:131-139` · high · sha:fda79c6bd580</sub>
- `JSON.parse` and `JSON.stringify` must be treated as real, O(payload-size) main-thread CPU costs on hot paths, not as a free serialization boundary.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/15-performance.md:141-144` · high · sha:fda79c6bd580</sub>
- Avoid parsing a body that will not be read, stringifying fields a consumer ignores, or round-tripping a value through JSON to clone it; use `structuredClone` for cloning instead.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/15-performance.md:145-145` · high · sha:fda79c6bd580</sub>
- Every module must be authored for tree-shaking, because shipped but unrun code inflates the bundle and lengthens parse/compile time and, on the client, delays interactivity.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/15-performance.md:155-158` · high · sha:fda79c6bd580</sub>
- Modules must export named bindings only, never a default object that staples everything together, so the bundler can prove individual exports are unused.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/15-performance.md:159-159` · high · sha:fda79c6bd580</sub>
- Set `"sideEffects": false` in `package.json` (or list the exact files that do have side effects) so the bundler may discard an unused import instead of retaining it for fear of an effect.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/15-performance.md:159-159` · high · sha:fda79c6bd580</sub>
- Modules must do no work at import time, since a top-level call is a side effect the bundler must preserve and this pins the module in the bundle.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/15-performance.md:159-159` · high · sha:fda79c6bd580</sub>
- Every deliberate optimization — a manual loop replacing a cleaner pipeline, a specialized serializer, a reused buffer — must carry the measurement (a comment at the site) that justifies deviating from the obvious, clean version.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/15-performance.md:170-175` · high · sha:fda79c6bd580</sub>
- The justification comment for an optimization must state what was slow, what the fix bought, and how it was measured, e.g. "p99 14ms → 1.9ms, --cpu-prof", rather than an unsupported adjective like "// fast path".
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/15-performance.md:174-174` · high · sha:fda79c6bd580</sub>

## Constraints
- V8 assigns every object a hidden class ("shape") from its properties, their order, and their types; a monomorphic access (always one shape) compiles to a direct offset load, while polymorphic or megamorphic access falls back to a slower hash lookup, and even a field's type changing (e.g. integer to float) forces a re-tag.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/15-performance.md:47-50` · high · sha:fda79c6bd580</sub>
- `delete obj.field` mutates the object's hidden class and, on repetition, can drop the object into slow, hashed dictionary mode that it never climbs out of.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/15-performance.md:63-66` · high · sha:fda79c6bd580</sub>
- `Promise.all` is unbounded fan-out, so firing a very large number of requests at once is its own outage; past a handful of concurrent calls it must be bounded with the worker-pool helper from the concurrency chapter.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/15-performance.md:100-100` · high · sha:fda79c6bd580</sub>
- Unexplained optimization does not survive review; reviewers simplify away cleverness for which no supporting measurement can be produced.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/15-performance.md:175-175` · high · sha:fda79c6bd580</sub>

## Conclusions
- The guide rejects the "always use Array.join for performance" myth, because pushing fragments into an array and joining at the end allocates the array and its elements first and is often the same speed as or slower than `+=` for ordinary string building.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/15-performance.md:130-130` · high · sha:fda79c6bd580</sub>
- The default is generic `JSON.stringify` until a profile names serialization as the bottleneck; only then is a schema-derived serializer justified, and it must ship with a benchmark and a ledger comment.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/15-performance.md:146-153` · high · sha:fda79c6bd580</sub>

## Reference
- Design-phase performance doctrine (the resource hierarchy, batching, caching, pooling) is defined in ../performance.md and is canonical across every language; the TypeScript performance chapter covers only the V8/TypeScript-specific layer below it.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/15-performance.md:3-3` · high · sha:fda79c6bd580</sub>
- `delete` on object properties is lint-enforced via `no-restricted-syntax` with the selector `UnaryExpression[operator='delete']`.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/15-performance.md:76-76` · high · sha:fda79c6bd580</sub>
- The `no-await-in-loop` lint rule flags the serial-await pattern that batching is meant to fix.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/15-performance.md:109-109` · high · sha:fda79c6bd580</sub>
- V8 represents string concatenation with ropes (cons-strings) — `a += b` allocates a small node pointing at the two pieces and flattens lazily rather than copying both operands into a new buffer — so building a string with `+=` in a loop is not the O(n²) cost it would be in languages without this optimization.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/15-performance.md:126-129` · high · sha:fda79c6bd580</sub>

## Conflicts

## Superseded
