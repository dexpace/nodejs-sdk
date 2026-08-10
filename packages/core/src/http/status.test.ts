// SPDX-License-Identifier: MIT
// packages/core/src/http/status.test.ts
// Exercises: HTTP-10 (total function, never throws), HTTP-11 (range classification), HTTP-12 (code-only equality)
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {Status} from './status.js';

describe('Status.of', () => {
  test('maps a known code to a named canonical instance', () => {
    const status = Status.of(200);
    expect(status.code).toBe(200);
    expect(status.name).toBe('OK');
    expect(status.isRecognized).toBe(true);
  });

  test('maps an unrecognized code to a raw, unnamed instance without throwing', () => {
    const status = Status.of(599);
    expect(status.code).toBe(599);
    expect(status.name).toBeUndefined();
    expect(status.isRecognized).toBe(false);
  });

  test('recognized() returns the canonical instance for a known code and absent for an unknown one', () => {
    expect(Status.recognized(200)).toBe(Status.of(200));
    expect(Status.recognized(599)).toBeUndefined();
  });

  test('never throws for any integer code, per the total-function property', () => {
    fc.assert(
      fc.property(fc.integer({min: 100, max: 999}), code => {
        expect(() => Status.of(code)).not.toThrow();
      }),
    );
  });
});

describe('range classification', () => {
  test.each([
    [100, 'isInformational'],
    [200, 'isSuccess'],
    [301, 'isRedirect'],
    [404, 'isClientError'],
    [500, 'isServerError'],
  ] as const)('code %i sets %s', (code, flag) => {
    expect(Status.of(code)[flag]).toBe(true);
  });

  test('400-599 are isError', () => {
    expect(Status.of(404).isError).toBe(true);
    expect(Status.of(500).isError).toBe(true);
    expect(Status.of(200).isError).toBe(false);
  });
});

describe('equals', () => {
  test('two Status values are equal iff their codes are equal, name does not participate', () => {
    expect(Status.of(200).equals(Status.of(200))).toBe(true);
    expect(Status.of(599).equals(Status.of(599))).toBe(true); // both unnamed, same code
    expect(Status.of(200).equals(Status.of(201))).toBe(false);
  });
});
