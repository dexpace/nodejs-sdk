// SPDX-License-Identifier: MIT
// examples/petstore/src/operation.ts
/**
 * The static/per-call split core does not have.
 *
 * **This file is finding 3.** `@dexpace/core`'s `OperationDescriptor` carries `method`,
 * `pathTemplate`, `pathParams`, `query`, `headers` and `body` in one interface. Four of those six
 * change on every call, so a descriptor cannot be the module-level constant a generated operation
 * table needs — a generator using it directly would have to build a fresh object per call and
 * would have nowhere to hang an operation's declared auth requirement.
 *
 * Splitting it costs nothing structurally: `Operation & OperationInput` is `OperationDescriptor`
 * plus a `name` and an `auth` slot, and {@link assemble} is the two-line merge that proves it. The
 * split is additive, so lifting it into core would not break the published `OperationDescriptor` —
 * `OperationDescriptor` can stay exactly as it is and be re-expressed as the union of the two
 * halves.
 */
import type {
  AuthDescriptor,
  Body,
  Headers,
  Method,
  OperationDescriptor,
  QueryParams,
} from '@dexpace/core';

/**
 * The half that is fixed when the SDK is generated: everything the frozen OpenAPI document knows.
 *
 * A generated operation table is a module of these, one per `operationId`, each frozen once at
 * module load and reused by every call.
 */
export interface Operation {
  /** The `operationId` from the document; carried for diagnostics and tracing, never sent. */
  readonly name: string;
  /** The HTTP method. */
  readonly method: Method;
  /** The path template, `{name}` placeholders intact. */
  readonly pathTemplate: string;
  /**
   * The operation's declared auth requirement — AUTH-4's `operation` tier.
   *
   * Core has the slot (`AuthTiers.operation`) and no source for it; this field is that source. See
   * FINDINGS.md, finding 4, for what the executor then has to do with it.
   */
  readonly auth?: AuthDescriptor | undefined;
}

/**
 * The half that changes per call: exactly `OperationDescriptor` minus `method` and `pathTemplate`.
 *
 * `?: T | undefined` rather than `?: T` throughout, because `exactOptionalPropertyTypes` is on and
 * a generated facade assigns every field including the ones it has nothing for.
 */
export interface OperationInput {
  /** Values for the path template's `{name}` placeholders. */
  readonly pathParams?: Readonly<Record<string, string>> | undefined;
  /** Query parameters appended after any the base URL already carries. */
  readonly query?: QueryParams | undefined;
  /** Headers carried onto the assembled request as-is. */
  readonly headers?: Headers | undefined;
  /** The already-encoded request body. */
  readonly body?: Body | undefined;
}

/** An empty input — a frozen singleton, since a facade method with no arguments needs one per call. */
export const NO_INPUT: OperationInput = Object.freeze({});

/**
 * Merge the two halves back into the descriptor `buildRequest` takes.
 *
 * The whole of core's assembly seam is reachable through this one line, which is the point: the
 * split is a re-shaping of the same data, not a parallel model.
 */
export function assemble(
  operation: Operation,
  input: OperationInput,
): OperationDescriptor {
  return {
    method: operation.method,
    pathTemplate: operation.pathTemplate,
    ...input,
  };
}
