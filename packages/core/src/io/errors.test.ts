// SPDX-License-Identifier: MIT
// packages/core/src/io/errors.test.ts
// Exercises: IO-4/IO-11/IO-12/IO-15 (EndOfStreamError), IO-17 (SourceContractViolationError),
// IO-24/IO-42 (ClosedResourceError), IO-9 (AllocationLimitError)
import {describe, expect, test} from 'bun:test';
import {DexpaceError} from '../http/errors.js';
import {
  AllocationLimitError,
  ClosedResourceError,
  EndOfStreamError,
  IoError,
  isIoError,
  SourceContractViolationError,
} from './errors.js';

describe('IoError tree', () => {
  test('IoError descends from DexpaceError', () => {
    expect(new IoError('boom')).toBeInstanceOf(DexpaceError);
  });

  test('every leaf descends from DexpaceError directly, not through IoError (Phase 3b retrofit)', () => {
    expect(new EndOfStreamError(3, 8)).toBeInstanceOf(DexpaceError);
    expect(new EndOfStreamError(3, 8)).not.toBeInstanceOf(IoError);
    expect(new SourceContractViolationError('zero read')).toBeInstanceOf(
      DexpaceError,
    );
    expect(new ClosedResourceError('BufferedSource')).toBeInstanceOf(
      DexpaceError,
    );
    expect(new AllocationLimitError(9, 8)).toBeInstanceOf(DexpaceError);
  });

  test('each error sets name from its own constructor', () => {
    expect(new EndOfStreamError(3, 8).name).toBe('EndOfStreamError');
    expect(new ClosedResourceError('ByteQueue').name).toBe(
      'ClosedResourceError',
    );
  });

  test('EndOfStreamError names delivered-of-requested as typed fields and in the message', () => {
    const error = new EndOfStreamError(3, 8);
    expect(error.delivered).toBe(3);
    expect(error.requested).toBe(8);
    expect(error.message).toBe('end of stream: delivered 3 of 8 bytes');
  });

  test('ClosedResourceError names the resource and is distinct from end-of-stream', () => {
    const error = new ClosedResourceError('BufferedSource');
    expect(error.message).toBe('BufferedSource is closed');
    expect(error).not.toBeInstanceOf(EndOfStreamError);
  });

  test('AllocationLimitError points at streaming alternatives', () => {
    const error = new AllocationLimitError(5_000, 4_000);
    expect(error.requested).toBe(5_000);
    expect(error.limit).toBe(4_000);
    expect(error.message).toBe(
      'cannot materialize 5000 bytes as one array (limit 4000); stream the body instead',
    );
  });

  test('cause chains through', () => {
    const cause = new RangeError('array too large');
    expect(new AllocationLimitError(5, 4, {cause}).cause).toBe(cause);
  });

  test('isIoError groups every leaf, including bare IoError, without a class tier', () => {
    expect(isIoError(new IoError('x'))).toBe(true);
    expect(isIoError(new EndOfStreamError(1, 2))).toBe(true);
    expect(isIoError(new SourceContractViolationError('x'))).toBe(true);
    expect(isIoError(new ClosedResourceError('x'))).toBe(true);
    expect(isIoError(new AllocationLimitError(1, 2))).toBe(true);
    expect(isIoError(new DexpaceError('other'))).toBe(false);
    expect(isIoError(new Error('plain'))).toBe(false);
  });
});
