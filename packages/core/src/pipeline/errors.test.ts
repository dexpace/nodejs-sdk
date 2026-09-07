// SPDX-License-Identifier: MIT
// packages/core/src/pipeline/errors.test.ts
// Exercises: PIPE-5 (PillarCollisionError), PIPE-21 (AnchorNotFoundError), PIPE-18/19 (CrossStageEditError),
// PIPE-11/15 (CursorAlreadyAdvancedError), PIPE-8 (ReservedStageError)
import {describe, expect, test} from 'bun:test';
import {DexpaceError} from '../http/errors.js';
import {
  AnchorNotFoundError,
  CrossStageEditError,
  CursorAlreadyAdvancedError,
  PillarCollisionError,
  ReservedStageError,
} from './errors.js';

describe('PillarCollisionError (PIPE-5)', () => {
  test('carries the stage and both colliding type symbols, extends DexpaceError', () => {
    const existing = Symbol('existing');
    const incoming = Symbol('incoming');

    const error = new PillarCollisionError('RETRY', existing, incoming);

    expect(error).toBeInstanceOf(DexpaceError);
    expect(error.name).toBe('PillarCollisionError');
    expect(error.stage).toBe('RETRY');
    expect(error.existingType).toBe(existing);
    expect(error.incomingType).toBe(incoming);
    // PIPE-5: the message itself names both types, not just the instance fields.
    expect(error.message).toContain('Symbol(existing)');
    expect(error.message).toContain('Symbol(incoming)');
  });
});

describe('AnchorNotFoundError (PIPE-21)', () => {
  test('carries the missing anchor type and the attempted operation', () => {
    const anchorType = Symbol('missing');

    const error = new AnchorNotFoundError(anchorType, 'insertAfter');

    expect(error).toBeInstanceOf(DexpaceError);
    expect(error.anchorType).toBe(anchorType);
    expect(error.operation).toBe('insertAfter');
    expect(error.message).toContain('Symbol(missing)'); // PIPE-21: the message identifies the type
  });
});

describe('CrossStageEditError (PIPE-18, PIPE-19)', () => {
  test('carries the anchor stage and the incoming stage', () => {
    const error = new CrossStageEditError('RETRY', 'AUTH');

    expect(error).toBeInstanceOf(DexpaceError);
    expect(error.anchorStage).toBe('RETRY');
    expect(error.incomingStage).toBe('AUTH');
  });
});

describe('CursorAlreadyAdvancedError (PIPE-11, PIPE-15)', () => {
  test('carries the stage of the step that reused its continuation', () => {
    const error = new CursorAlreadyAdvancedError('RETRY');

    expect(error).toBeInstanceOf(DexpaceError);
    expect(error.stage).toBe('RETRY');
  });
});

describe('ReservedStageError (PIPE-8)', () => {
  test('carries the attempted operation', () => {
    const error = new ReservedStageError('append');

    expect(error).toBeInstanceOf(DexpaceError);
    expect(error.operation).toBe('append');
  });
});
