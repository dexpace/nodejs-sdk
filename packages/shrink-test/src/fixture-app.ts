// SPDX-License-Identifier: MIT
// packages/shrink-test/src/fixture-app.ts
import {jsonSerde} from '@dexpace/codec-json';
import {
  IoError,
  Page,
  Request,
  type Response,
  type Schema,
  type Transport,
} from '@dexpace/core';
import {fetchTransport} from '@dexpace/transport-fetch';

/**
 * What {@link runFixtureApp} reports back to the guard from the child process.
 *
 * Every field is a boolean the guard requires to be `true`; the generated runner fails on any `false`
 * one without needing to be edited, so a new probe only has to be added here.
 */
export interface FixtureResult {
  /** True when the error thrown by `transport-fetch` matched `IoError` imported from `core`. */
  readonly caughtViaCoreImport: boolean;
  /** True when a serialize/deserialize round trip through `codec-json` returned the input. */
  readonly serdeRoundTripOk: boolean;
  /** True when the module-scope `[Symbol.asyncDispose]` installs survived the tree-shaking pass. */
  readonly disposalSymbolSurvived: boolean;
}

/** The one shape the round trip carries; a hand-written `Schema` keeps the fixture codec-agnostic. */
interface ShrinkProbe {
  readonly shrinkTest: boolean;
}

/**
 * `Deserializer.deserialize` takes a `Schema<T>` witness rather than a reflected type token
 * (`docs/sdk-design-nodejs/10` item 7's schema-as-witness substitution), so the fixture supplies a
 * minimal one instead of reaching for a validation library it would then have to bundle.
 */
const shrinkProbeSchema: Schema<ShrinkProbe> = {
  parse(input: unknown): ShrinkProbe {
    if (
      typeof input !== 'object' ||
      input === null ||
      typeof (input as {shrinkTest?: unknown}).shrinkTest !== 'boolean'
    ) {
      throw new TypeError('not a ShrinkProbe');
    }
    return {shrinkTest: (input as ShrinkProbe).shrinkTest};
  },
};

/**
 * The narrowest stand-in for the three fields `Page`'s constructor reads.
 *
 * A real `Response` needs a live transport exchange to produce, and {@link probeDisposalSymbol} only
 * needs an instance whose prototype came out of the bundle -- the response is never read again.
 */
function stubResponse(): Response {
  return {
    status: {code: 204},
    headers: {get: (): undefined => undefined},
    request: {method: 'GET'},
    close: (): Promise<void> => Promise.resolve(),
  } as unknown as Response;
}

/** True when `value` carries a callable `[Symbol.asyncDispose]`, however it was installed. */
function hasAsyncDispose(value: object, disposeSymbol: symbol): boolean {
  return (
    typeof (value as Record<symbol, unknown>)[disposeSymbol] === 'function'
  );
}

/**
 * Proves that the module-scope `[Symbol.asyncDispose]` installs survive a bundle round trip.
 *
 * `Page` and `FetchTransport` (and `SseStream`, and `UndiciTransport`) do not declare disposal as a
 * class member: Node 20.3 is the workspace floor and predates the symbol, so declaring it would emit
 * a `.d.ts` promise the floor cannot keep (NFR-10). The method is instead installed by a guarded
 * `Object.defineProperty` **statement that runs when the module is evaluated** -- a module-level side
 * effect, in packages that all declare `"sideEffects": false`.
 *
 * That manifest field entitles a bundler to drop a module whose exports go unused, and nothing stops
 * a future one from also dropping a top-level statement it judges inert. Here the classes *are* used,
 * so the modules are kept and the install runs; this asserts that outcome rather than assuming it,
 * inside the same real `bundle + minify + treeShaking` pass the rest of the guard uses.
 *
 * Read through a cast rather than a bare `Symbol.asyncDispose` index, matching the guarded install:
 * on the declared floor the symbol is `undefined` and the index would read the string key
 * `"undefined"`. Absent symbol means the install is *supposed* to leave nothing behind, so the probe
 * is vacuously true there.
 */
function probeDisposalSymbol(transport: Transport): boolean {
  const disposeSymbol = (Symbol as {asyncDispose?: symbol}).asyncDispose;
  if (typeof disposeSymbol !== 'symbol') return true;
  return (
    hasAsyncDispose(new Page(stubResponse(), []), disposeSymbol) &&
    hasAsyncDispose(transport, disposeSymbol)
  );
}

/**
 * Runs inside the bundled, tree-shaken artifact -- never against `src/` directly, which is the whole
 * point (see `run-shrink-guard.ts`).
 *
 * Proves the three properties a bundler round trip can silently break. First, cross-package
 * `instanceof`: `TransportFailureError` is thrown by `@dexpace/transport-fetch` and its base class
 * `IoError` is imported here from `@dexpace/core`, so the check passes only if the bundle contains
 * exactly ONE copy of core's class identity. Two copies -- the dual-package hazard
 * `docs/knowledge/tooling-and-quality-gates.md` names, and the risk this port substitutes for the
 * reference's reflective keep-rules (`NFR-8`, deviation-ledger item 10) -- make it silently false
 * while every type still checks. Second, that a real serde round trip still works once the codec has
 * been through the same minifier. Third, that the module-scope disposal installs are still there --
 * see {@link probeDisposalSymbol}.
 *
 * Port 1 is chosen because nothing listens there: the connection is refused immediately, so the
 * guard needs no fixture server and cannot hang on a slow socket.
 *
 * @returns every check, for the parent process to assert on.
 */
export async function runFixtureApp(): Promise<FixtureResult> {
  const transport = fetchTransport();
  let caughtViaCoreImport = false;
  try {
    await transport.send(
      Request.newBuilder().url('http://127.0.0.1:1/').method('GET').build(),
    );
  } catch (error) {
    caughtViaCoreImport = error instanceof IoError;
  } finally {
    await transport.close();
  }

  const serde = jsonSerde();
  const bytes = serde.serializer.serialize({shrinkTest: true});
  const decoded = serde.deserializer.deserialize(bytes, shrinkProbeSchema);

  return {
    caughtViaCoreImport,
    serdeRoundTripOk: decoded.shrinkTest,
    disposalSymbolSurvived: probeDisposalSymbol(transport),
  };
}
