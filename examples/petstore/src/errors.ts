// SPDX-License-Identifier: MIT
// examples/petstore/src/errors.ts
/**
 * The typed error taxonomy for the petstore canary, and the declarative status-to-error map the
 * executor consults.
 *
 * **This whole file is finding 2.** `@dexpace/core` produces exactly one class for a failure
 * status: `decodeSuccessResponse` calls `toHttpError`, which returns `HttpStatusError` and nothing
 * else. A service SDK that wants `PetNotFoundError` for a 404 therefore has to catch that one
 * class and re-map it by status code — which is what {@link remapStatusError} does, and what every
 * generated SDK would otherwise reimplement.
 *
 * The re-map is lossy in one respect worth recording: `toHttpError` has already drained and closed
 * the response by the time the mapping runs, so the mapped error is built from the buffered
 * `HttpStatusError`, never from the live response. That is fine here — the buffered copy carries
 * the status, the media type and a bounded body — but it means a service error class can never see
 * anything `HttpStatusError` did not keep.
 */
import {
  DexpaceError,
  HttpStatusError,
  IoError,
  TransportFailureError,
} from '@dexpace/core';

/** Base class for every typed petstore response error. */
export class PetStoreError extends DexpaceError {
  /** The response status that produced this error. */
  readonly status: number;
  /** A bounded, non-consuming preview of the error body; `null` when there was none. */
  readonly preview: string | null;

  constructor(cause: HttpStatusError) {
    super(`petstore: HTTP ${String(cause.status)}`, {cause});
    this.status = cause.status;
    this.preview = cause.preview();
  }
}

/** Raised for a 404 — no pet matched the requested id. */
export class PetNotFoundError extends PetStoreError {}

/**
 * What a status maps to: a class constructible from the `HttpStatusError` core already produced.
 *
 * Typed against `DexpaceError` rather than `PetStoreError` so {@link createStatusErrorMap}'s
 * validation is a real check on a caller-supplied class rather than a restatement of the parameter
 * type.
 */
export type StatusErrorConstructor = new (
  cause: HttpStatusError,
) => DexpaceError;

/** A declarative status-to-error table: the Node shape of Python's `StatusErrorMap`. */
export interface StatusErrorMap {
  /** Exact status matches, most specific. */
  readonly byStatus: ReadonlyMap<number, StatusErrorConstructor>;
  /** Applied to any 4xx/5xx the table does not name. */
  readonly fallback: StatusErrorConstructor;
}

/**
 * Reject a mapped class that sits on the TRANSPORT branch of the error tree.
 *
 * Python enforces the equivalent rule (`HttpResponseError`, never `OSError`) so an
 * `except OSError:` site cannot start catching service errors. The Node tree is
 * `DexpaceError` -> {`HttpStatusError`, `IoError`, `TransportFailureError`, ...}, and single
 * inheritance means a class cannot be on both branches — but nothing stops a caller mapping a 404
 * to a subclass of `IoError`, which is exactly what the rule forbids and what this rejects.
 */
function assertResponseBranch(
  ctor: StatusErrorConstructor,
  label: string,
): void {
  if (
    ctor.prototype instanceof IoError ||
    ctor.prototype instanceof TransportFailureError
  ) {
    throw new TypeError(
      `${label} is on the transport branch of the error tree; a mapped status error must not be`,
    );
  }
  if (!(ctor.prototype instanceof DexpaceError)) {
    throw new TypeError(`${label} must extend DexpaceError`);
  }
}

/**
 * Build a validated {@link StatusErrorMap}.
 *
 * Validation runs at construction, not per response: a misconfigured table is a programmer error
 * and should surface where the table is written, not on the one production request that happens to
 * receive the status it got wrong.
 */
export function createStatusErrorMap(init: {
  readonly byStatus?:
    Readonly<Record<number, StatusErrorConstructor>> | undefined;
  readonly fallback: StatusErrorConstructor;
}): StatusErrorMap {
  assertResponseBranch(init.fallback, 'the fallback error class');
  const byStatus = new Map<number, StatusErrorConstructor>();
  for (const [key, ctor] of Object.entries(init.byStatus ?? {})) {
    assertResponseBranch(ctor, `the error class mapped to status ${key}`);
    byStatus.set(Number(key), ctor);
  }
  return Object.freeze({byStatus, fallback: init.fallback});
}

/**
 * Re-map an `HttpStatusError` through the table; anything else passes through untouched.
 *
 * `unknown` in, `unknown` out, so a call site can use it directly in a `catch` without narrowing
 * first — and so a transport failure, a `DeserializationError`, or an `AuthResolutionError` reach
 * the caller as themselves rather than being laundered into a service error.
 */
export function remapStatusError(
  error: unknown,
  map: StatusErrorMap | undefined,
): unknown {
  if (map === undefined || !(error instanceof HttpStatusError)) return error;
  const ctor = map.byStatus.get(error.status) ?? map.fallback;
  return new ctor(error);
}

/** The petstore's own table: a 404 is a `PetNotFoundError`, everything else a `PetStoreError`. */
export const PETSTORE_ERRORS: StatusErrorMap = createStatusErrorMap({
  byStatus: {404: PetNotFoundError},
  fallback: PetStoreError,
});
