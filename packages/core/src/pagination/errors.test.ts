// SPDX-License-Identifier: MIT
// packages/core/src/pagination/errors.test.ts
// Exercises: PAGE-9 (cap validated at construction), PAGE-14 (re-iteration fails loudly).
import {expect, test} from 'bun:test';
import {DexpaceError} from '../http/errors.js';
import {PaginationError} from './errors.js';

test('sits directly under DexpaceError (two-level tree)', () => {
  expect(new PaginationError('x')).toBeInstanceOf(DexpaceError);
});

test('name identifies the leaf in a stack trace', () => {
  expect(new PaginationError('x').name).toBe('PaginationError');
});

test('chains a cause when given one', () => {
  const backing = new Error('root');
  expect(new PaginationError('x', {cause: backing}).cause).toBe(backing);
});
