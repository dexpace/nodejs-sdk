// SPDX-License-Identifier: MIT
// packages/core/src/recovery/status-mapping.ts
import {toHttpError} from '../body/http-status-error.js';
import type {Response} from '../http/response.js';

/**
 * The status → typed-exception mapping response step (RECOV-15, RECOV-16).
 *
 * Phase 3b's `toHttpError()` already satisfies both requirements in full: it treats only 400..599
 * as errors and hands every other status back unchanged (RECOV-15), and it buffers the error body
 * into a bounded, replayable in-memory copy inside the response's own close-guaranteeing scope
 * before mapping, sharing the same 1 MiB cap 3b's logging tees use (RECOV-16). `HttpStatusError` —
 * flat, carrying `status` and the buffered body — IS the "matching typed exception"; no new
 * buffering, no per-status class hierarchy.
 *
 * The `throw` is deliberate: it lets RECOV-7 in `response-chain.ts` convert an error status into a
 * Failure exactly the way any other response-step throw is handled, rather than this step
 * special-casing its own error path.
 *
 * @param response - the response to inspect.
 * @returns the response unchanged when its status is not an error status.
 * @throws HttpStatusError when the status is in 400..599.
 *
 * @internal
 */
export async function statusMappingStep(response: Response): Promise<Response> {
  const httpError = await toHttpError(response);
  if (httpError === null) return response;
  throw httpError;
}

// A named declaration, not `const statusMappingStep: ResponseStep = async response => ...`: arrows
// are reserved for inline callbacks (docs/knowledge/harvested/function-design.md:18-21), and a named
// declaration survives in stack traces — which a function whose whole job is to throw actually
// depends on. `func-style`'s `allowArrowFunctions: true` would not have flagged the arrow form, so
// this is on the author, not the gate.
//
// The proof that the signature still conforms to `ResponseStep` lives in the test file, as an
// `expectTypeOf` assertion. A module-level `statusMappingStep satisfies ResponseStep;` would do the
// same job, but `satisfies` erases to its operand rather than to nothing, leaving a dead
// `statusMappingStep;` expression statement in the published `dist/`.
