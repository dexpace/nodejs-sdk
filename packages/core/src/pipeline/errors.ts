// SPDX-License-Identifier: MIT
// packages/core/src/pipeline/errors.ts
import {DexpaceError} from '../http/errors.js';
import type {Stage} from './stage.js';

/**
 * PIPE-5: installing a distinct second step onto an occupied pillar; names both types and the stage.
 *
 * @internal
 */
export class PillarCollisionError extends DexpaceError {
  readonly stage: Stage;
  readonly existingType: symbol;
  readonly incomingType: symbol;

  // eslint-disable-next-line max-params -- constructor parameters fixed by error model: PIPE-5 requires the stage and BOTH colliding types, plus the taxonomy's trailing `options?: ErrorOptions`; same exemption as HttpStatusError. Revisit only if the error model drops a field.
  constructor(
    stage: Stage,
    existingType: symbol,
    incomingType: symbol,
    options?: ErrorOptions,
  ) {
    // PIPE-5: the error names BOTH step types and points at the replace path. Symbols are rendered with
    // String() (`Symbol(retry)`) -- a bare symbol field is invisible in a stack trace or log line
    // (docs/knowledge/harvested/error-handling.md:40), the same reason 4a's DuplicateContextKeyError renders its key.
    super(
      `pillar stage '${stage}' already holds ${String(existingType)}; cannot install ${String(incomingType)} (use replace() to swap it)`,
      options,
    );
    this.stage = stage;
    this.existingType = existingType;
    this.incomingType = incomingType;
  }
}

/**
 * PIPE-21: an insertAfter/insertBefore/replace whose anchor type matches nothing in the pipeline.
 *
 * @internal
 */
export class AnchorNotFoundError extends DexpaceError {
  readonly anchorType: symbol;
  readonly operation: string;

  constructor(anchorType: symbol, operation: string, options?: ErrorOptions) {
    // PIPE-21: "fail with an error identifying the missing type" -- in the message, not only as a field.
    super(
      `${operation}: no step of type ${String(anchorType)} is present in the pipeline`,
      options,
    );
    this.anchorType = anchorType;
    this.operation = operation;
  }
}

/**
 * PIPE-18/PIPE-19: a cross-stage insert/replace -- the incoming descriptor's stage differs from the
 * anchor's.
 *
 * @internal
 */
export class CrossStageEditError extends DexpaceError {
  readonly anchorStage: Stage;
  readonly incomingStage: Stage;

  constructor(
    anchorStage: Stage,
    incomingStage: Stage,
    options?: ErrorOptions,
  ) {
    super(
      `cannot insert/replace across stages: anchor is in '${anchorStage}', incoming step declares '${incomingStage}'`,
      options,
    );
    this.anchorStage = anchorStage;
    this.incomingStage = incomingStage;
  }
}

/**
 * PIPE-11/PIPE-15: a step reused an already-invoked next()/fork() continuation instead of forking again.
 *
 * @internal
 */
export class CursorAlreadyAdvancedError extends DexpaceError {
  readonly stage: Stage;

  constructor(stage: Stage, options?: ErrorOptions) {
    super(
      `step at stage '${stage}' reused an already-invoked continuation; a re-driving step must call fork() again`,
      options,
    );
    this.stage = stage;
  }
}

/**
 * PIPE-8: an attempt to install a user step onto the reserved, terminal SEND stage.
 *
 * @internal
 */
export class ReservedStageError extends DexpaceError {
  readonly operation: string;

  constructor(operation: string, options?: ErrorOptions) {
    super(
      `${operation}: the SEND stage is reserved for the terminal transport hop and cannot hold a user step`,
      options,
    );
    this.operation = operation;
  }
}
