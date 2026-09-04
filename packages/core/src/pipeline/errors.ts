// SPDX-License-Identifier: MIT
// packages/core/src/pipeline/errors.ts
import {DexpaceError} from '../http/errors.js';
import type {Stage} from './stage.js';

/**
 * PIPE-5: installing a distinct second step onto an occupied pillar; names both types and the stage.
 *
 * @public
 */
export class PillarCollisionError extends DexpaceError {
  /** The pillar stage that was already occupied. */
  readonly stage: Stage;
  /** The step type already installed there. */
  readonly existingType: symbol;
  /** The step type the rejected install tried to add. */
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
 * @public
 */
export class AnchorNotFoundError extends DexpaceError {
  /** The step type named as the anchor, which no installed step carries. */
  readonly anchorType: symbol;
  /** The builder operation that failed -- `insertAfter`, `insertBefore` or `replace`. */
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
 * @public
 */
export class CrossStageEditError extends DexpaceError {
  /** The stage the anchor step occupies. */
  readonly anchorStage: Stage;
  /** The stage the incoming descriptor declares, which differs from the anchor's. */
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
 * @public
 */
export class CursorAlreadyAdvancedError extends DexpaceError {
  /** The stage of the step that reused its continuation. */
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
 * @public
 */
export class ReservedStageError extends DexpaceError {
  /** The builder operation that tried to write to the reserved SEND stage. */
  readonly operation: string;

  constructor(operation: string, options?: ErrorOptions) {
    super(
      `${operation}: the SEND stage is reserved for the terminal transport hop and cannot hold a user step`,
      options,
    );
    this.operation = operation;
  }
}
