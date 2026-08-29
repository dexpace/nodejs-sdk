// SPDX-License-Identifier: MIT
// packages/shrink-test/src/fixture-app.ts
import {jsonSerde} from '@dexpace/codec-json';
import {IoError, Request, type Schema} from '@dexpace/core';
import {fetchTransport} from '@dexpace/transport-fetch';

/** What {@link runFixtureApp} reports back to the guard, over stdout, from the child process. */
export interface FixtureResult {
  /** True when the error thrown by `transport-fetch` matched `IoError` imported from `core`. */
  readonly caughtViaCoreImport: boolean;
  /** True when a serialize/deserialize round trip through `codec-json` returned the input. */
  readonly serdeRoundTripOk: boolean;
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
 * Runs inside the bundled, tree-shaken artifact -- never against `src/` directly, which is the whole
 * point (see `run-shrink-guard.ts`).
 *
 * Proves the two properties a bundler round trip can silently break. First, cross-package
 * `instanceof`: `TransportFailureError` is thrown by `@dexpace/transport-fetch` and its base class
 * `IoError` is imported here from `@dexpace/core`, so the check passes only if the bundle contains
 * exactly ONE copy of core's class identity. Two copies -- the dual-package hazard
 * `docs/knowledge/tooling-and-quality-gates.md` names, and the risk this port substitutes for the
 * reference's reflective keep-rules (`NFR-8`, deviation-ledger item 10) -- make it silently false
 * while every type still checks. Second, that a real serde round trip still works once the codec has
 * been through the same minifier.
 *
 * Port 1 is chosen because nothing listens there: the connection is refused immediately, so the
 * guard needs no fixture server and cannot hang on a slow socket.
 *
 * @returns both checks, for the parent process to assert on.
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

  return {caughtViaCoreImport, serdeRoundTripOk: decoded.shrinkTest};
}
