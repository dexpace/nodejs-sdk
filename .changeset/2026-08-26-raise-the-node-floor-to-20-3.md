---
"@dexpace/core": minor
---

Raise `engines.node` from `>=18.17` to `>=20.3`, and `lib`/`target` from `ES2022` to `ES2023` with it.

The declared floor was not real. `MultipartBody` generates its boundary from `crypto.getRandomValues`, and Node
exposes `globalThis.crypto` unflagged only from **19.0.0** — never to an ES module on any 18.x release, verified
on both 18.17.0 and 18.20.8. Every `multipartBody(...)` call threw `ReferenceError: crypto is not defined` on the
version `engines.node` promised. `bun test` could not see it, because Bun supplies the global; the Node
conformance suite caught it the first time it ran the built artifact on the pinned floor.

The floor is `>=20.3` rather than `>=20.0` because `AbortSignal.any()` — `composeSignal`'s own floor-defining
call, backported to 18.17.0 — reached the 20.x line only in 20.3.0. Confirmed by running the suite against a
pinned 20.0.0, where `composeSignal` fails with `AbortSignal.any is not a function`.

Raising the floor was chosen over the two alternatives that keep Node 18. A `node:crypto` fallback puts a
Node-only specifier in a package documented as running on browsers, Deno, Bun and Workers, and cannot be reached
synchronously from the constructor that needs it. A non-crypto fallback RNG silently downgrades the
unguessable-boundary mitigation `HTTP-51` leans on against multipart injection, on exactly the runtime CI pins.
Node 18 reached end of life in April 2025, so no supported runtime is dropped.

Also in this change:

- `verify:runtime-floor`'s pairing table moves its `es2023` row to `>=20.3`, with the built-ins the SDK calls —
  not the syntax it emits — named as the reason the floor sits above the language level's own minimum.
- The `node-conformance` CI matrix pins `20.3.0` in place of `18.17.0`.
- The conformance suite gains a case asserting `globalThis.crypto.getRandomValues` is a function **in ESM**, so
  this floor cannot regress silently. Node 18 exposed `crypto` to CommonJS while leaving it undefined in ES
  modules, so a CJS probe would have reported the old floor as satisfied.
- `seams.test.mjs` holds the event loop open with a ref'd deadline while awaiting an `AbortSignal.timeout()`
  abort. That timer is unref'd on every Node version by design, so with nothing else scheduled the loop drained
  before it fired and Node 18.17.0's test runner cancelled the rest of the file. Newer runners kept the loop
  alive through handles of their own, which is why this passed on current LTS and failed only on the floor.
- `sdk-design-nodejs/02`'s runtime-requirement line is corrected; it had claimed Node ≥18.17 supplies
  `globalThis.crypto.subtle`.

`Symbol.asyncDispose` is still not declared anywhere. The symbols reached the 20.x line in 20.4.0, one patch
above this floor, and re-adding them remains checkpoint §5.4's job across all seven resource owners at once.
