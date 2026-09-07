// SPDX-License-Identifier: MIT
// packages/core/src/sse/event.test.ts
// Exercises: SSE-20 (immutable, defensively-copied data list), SSE-21 (structural equality, stable string form),
// SSE-22 (is-empty true only when all five fields are unset; a comment counts as content).
import {expect, test} from 'bun:test';
import {InvariantViolation} from '../invariant.js';
import {
  isSseEventEmpty,
  makeSseEvent,
  sseEventToString,
  sseEventsEqual,
} from './event.js';

test('the data list is defensively copied at construction (SSE-20)', () => {
  const supplied = ['a', 'b'];
  const event = makeSseEvent({data: supplied});
  supplied.push('c');
  expect(event.data).toEqual(['a', 'b']);
});

test('the event and its data list are frozen (SSE-20)', () => {
  const event = makeSseEvent({data: ['a']});
  expect(Object.isFrozen(event)).toBe(true);
  expect(Object.isFrozen(event.data)).toBe(true);
});

test('unset fields are undefined and data defaults to an empty list', () => {
  const event = makeSseEvent({});
  expect(event.id).toBeUndefined();
  expect(event.event).toBeUndefined();
  expect(event.comment).toBeUndefined();
  expect(event.retryMs).toBeUndefined();
  expect(event.data).toEqual([]);
});

test('equality is structural over all five fields (SSE-21)', () => {
  const a = makeSseEvent({
    id: '1',
    event: 'ping',
    data: ['x'],
    comment: 'c',
    retryMs: 5,
  });
  const b = makeSseEvent({
    id: '1',
    event: 'ping',
    data: ['x'],
    comment: 'c',
    retryMs: 5,
  });
  expect(sseEventsEqual(a, b)).toBe(true);
});

test('equality distinguishes present-but-empty from absent (SSE-4 seen through SSE-21)', () => {
  expect(sseEventsEqual(makeSseEvent({event: ''}), makeSseEvent({}))).toBe(
    false,
  );
});

test('equality is order-sensitive across the data list', () => {
  expect(
    sseEventsEqual(
      makeSseEvent({data: ['a', 'b']}),
      makeSseEvent({data: ['b', 'a']}),
    ),
  ).toBe(false);
});

test('the string form is stable and leaks no identity (SSE-21)', () => {
  const rendered = sseEventToString(makeSseEvent({id: '1', data: ['x']}));
  expect(rendered).toBe(sseEventToString(makeSseEvent({id: '1', data: ['x']})));
  expect(rendered).not.toMatch(/\[object|0x[0-9a-f]+/);
});

test('is-empty is true only when every field is unset (SSE-22)', () => {
  expect(isSseEventEmpty(makeSseEvent({}))).toBe(true);
  expect(isSseEventEmpty(makeSseEvent({data: ['']}))).toBe(false);
  expect(isSseEventEmpty(makeSseEvent({event: ''}))).toBe(false);
});

test('a comment-only event is NOT empty — a comment counts as content (SSE-22)', () => {
  expect(isSseEventEmpty(makeSseEvent({comment: 'keep-alive'}))).toBe(false);
});

test('a NUL-bearing id cannot be built into an event — SSE-9 drops it at the parser', () => {
  expect(() => makeSseEvent({id: 'a\u0000b'})).toThrow(InvariantViolation);
});

test('a negative or non-integer retryMs cannot be built into an event (SSE-11)', () => {
  expect(() => makeSseEvent({retryMs: -1})).toThrow(InvariantViolation);
  expect(() => makeSseEvent({retryMs: 1.5})).toThrow(InvariantViolation);
});
