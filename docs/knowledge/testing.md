# testing

## Rules
- Import all test symbols explicitly from `bun:test` (e.g., `describe`, `it`, `expect`) rather than relying on them as ambient globals.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/11-testing.md:47-47` · high · sha:9f3e967e1dcc</sub>
- Colocate unit tests beside their subject module as `foo.test.ts` next to `foo.ts`.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/11-testing.md:48-48` · high · sha:9f3e967e1dcc</sub>
- Place integration and end-to-end tests, which cross process or network boundaries, under a top-level `tests/` directory rather than beside a single module.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/11-testing.md:48-48` · high · sha:9f3e967e1dcc</sub>
- Structure every test in three blank-line-separated sections — arrange, act, assert — with exactly one act (the operation under test).
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/11-testing.md:61-62` · high · sha:9f3e967e1dcc</sub>
- Write one behaviour per test; split a test that would assert multiple unrelated facts so each failure names exactly what broke.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/11-testing.md:62-62` · high · sha:9f3e967e1dcc</sub>
- Name each test in the shape `<verb-phrase> when <condition>`, describing what broke and under what condition, so the name works as the failure message read in CI logs and IDE trees.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/11-testing.md:63-63` · high · sha:9f3e967e1dcc</sub>
- For code you own, write a hand-rolled, in-memory fake implementation of the interface rather than a mock that returns canned values.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/11-testing.md:79-80` · high · sha:9f3e967e1dcc</sub>
- Reserve `bun:test`'s `mock.module` for true externals — a third-party SDK or a module with import-time side effects that cannot otherwise be severed — never for an owned interface.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/11-testing.md:81-81` · high · sha:9f3e967e1dcc</sub>
- Name a test double for what it is, such as `FakeUserRepository` or `StubClock`, and never label a hand-rolled fake as a "Mock".
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/11-testing.md:81-81` · high · sha:9f3e967e1dcc</sub>
- Never reassign `globalThis.fetch` to a mock when testing server HTTP; it skips routing, URL construction, headers, status handling, and serialization.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/11-testing.md:96-96` · high · sha:9f3e967e1dcc</sub>
- Test server-side HTTP handlers by handing the app a real `Request` object and asserting on the real `Response` it returns (e.g., `app.request(...)` for a Hono app), with no socket opened and no monkey-patched `fetch`.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/11-testing.md:97-97` · high · sha:9f3e967e1dcc</sub>
- Reserve MSW (Mock Service Worker) for React component tests that call an upstream not owned by the component; server-side HTTP tests do not use MSW.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/11-testing.md:98-98` · high · sha:9f3e967e1dcc</sub>
- Codecs, parsers, serializers, and invariant-bearing functions must ship with a `fast-check` property-based test covering at least one canonical law.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/11-testing.md:110-114` · high · sha:9f3e967e1dcc</sub>
- Every exported generic type and conditional type must ship with a type-level test using `expectTypeOf` from the standalone `expect-type` package.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/11-testing.md:130-134` · high · sha:9f3e967e1dcc</sub>
- Type-level tests must prove the negative case is rejected, using `expectTypeOf(badCall).toBeNever()` or a `@ts-expect-error` line proving misuse does not compile.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/11-testing.md:134-134` · high · sha:9f3e967e1dcc</sub>
- Every custom type guard (`x is T`) must have a truth-table test covering every positive case it must accept and every negative case it must reject, including wrong type, missing field, null, and the empty object.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/11-testing.md:144-148` · high · sha:9f3e967e1dcc</sub>
- Make every test deterministic by using no real network, clock, or filesystem access in a unit test.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/11-testing.md:160-163` · high · sha:9f3e967e1dcc</sub>
- Virtualize time using `bun:test`'s `setSystemTime(date)` to pin the clock to a fixed instant, and call `setSystemTime()` with no argument to restore the real clock.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/11-testing.md:164-164` · high · sha:9f3e967e1dcc</sub>
- Never await a real `setTimeout` in a test to "give it a moment."
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/11-testing.md:164-164` · high · sha:9f3e967e1dcc</sub>
- Prefer injecting clocks and ID generators as parameters over reading `Date.now()` or `crypto.randomUUID()` directly, treating `setSystemTime` as a seam of last resort for code that reads the clock directly.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/11-testing.md:164-164` · high · sha:9f3e967e1dcc</sub>
- Log the seed of a failing seeded `fast-check` property test in CI output, or the shrunk counterexample that found the bug is lost.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/11-testing.md:165-165` · high · sha:9f3e967e1dcc</sub>
- Assert both positive space (what must have happened) and negative space (what must not have happened) for tests of non-trivial behaviour.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/11-testing.md:176-179` · high · sha:9f3e967e1dcc</sub>
- Prefer a pair-assertion that verifies the same property two independent ways over padding a test with unrelated assertions to hit an assertion count.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/11-testing.md:180-180` · high · sha:9f3e967e1dcc</sub>
- Every test must run alone, in any order, and survive parallel execution, since `bun test` can parallelize under `--concurrent`/`test.concurrent`.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/11-testing.md:194-197` · high · sha:9f3e967e1dcc</sub>
- Build fixtures fresh per test — inline, in `beforeEach`, or via a factory function — and never share a mutable fixture across tests.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/11-testing.md:198-199` · high · sha:9f3e967e1dcc</sub>
- Report code coverage as a trend using `bun test --coverage` (lcov output) and never target it as a pass/fail gate for a build.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/11-testing.md:210-213` · high · sha:9f3e967e1dcc</sub>
- Treat the test as the first real caller of the code under test, written before any other caller exists.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/11-testing.md:226-229` · high · sha:9f3e967e1dcc</sub>
- When a test requires heavy scaffolding (many mocks, poked-in global state), fix the production code's API — accept dependencies as parameters, narrow the surface, split the function — rather than adding more test setup.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/11-testing.md:230-230` · high · sha:9f3e967e1dcc</sub>

## Constraints
- No mutation-testing runner exists for `bun test` (Stryker has no Bun runner), so mutation testing is a recorded, accepted gap rather than a silent omission.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/11-testing.md:214-214` · high · sha:9f3e967e1dcc</sub>

## Conclusions
- Mutation testing is planned to return as a nightly job the moment a Bun-compatible mutation-testing runner becomes available.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/11-testing.md:214-214` · high · sha:9f3e967e1dcc</sub>

## Reference
- Multiple assertions on the same behaviour within a single test are acceptable and not a violation of the one-behaviour-per-test rule.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/11-testing.md:62-62` · high · sha:9f3e967e1dcc</sub>
- The four canonical property-based test laws are round-trip (decode(encode(x)) equals x), idempotence (f(f(x)) equals f(x)), order-insensitivity, and bounds.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/11-testing.md:114-114` · high · sha:9f3e967e1dcc</sub>
- Type-level `expectTypeOf` tests are checked by the `tsc --noEmit` CI gate, not by `bun test`, because `bun test` strips types and never checks them.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/11-testing.md:134-134` · high · sha:9f3e967e1dcc</sub>
- Truth-table tests apply only to custom type guards, not to `typeof`/`instanceof`/`in` narrowing, which the compiler implements and verifies itself.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/11-testing.md:148-148` · high · sha:9f3e967e1dcc</sub>
- Immutable shared data such as a frozen constant or a parsed schema is safe to hoist across tests, while mutable state never is.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/11-testing.md:199-199` · high · sha:9f3e967e1dcc</sub>

## Conflicts

## Superseded
