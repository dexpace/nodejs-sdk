// SPDX-License-Identifier: MIT
// packages/core/src/sse/event.ts
import {invariant} from '../invariant.js';

/**
 * One parsed Server-Sent Event (SSE-20).
 *
 * A frozen plain object, not a class: it has no lifecycle, no invariant to maintain past construction, and no
 * behavior — `styleguide/typescript/06` §6.3's test for a data structure rather than an object. Equality and
 * rendering are therefore free functions in this module, not methods.
 *
 * `undefined` means the field was **absent** from the block. A field present with an empty value is `''`, and
 * that distinction is load-bearing (SSE-4): an empty `event:` is a present empty event name, not a missing one.
 *
 * @public
 */
export interface SseEvent {
  readonly id: string | undefined;
  readonly event: string | undefined;
  /** Raw per-line `data` values in wire order, never joined at this layer (SSE-8). */
  readonly data: readonly string[];
  readonly comment: string | undefined;
  readonly retryMs: number | undefined;
}

/**
 * Fields used to construct an {@link SseEvent}.
 *
 * @public
 */
export interface SseEventFields {
  readonly id?: string | undefined;
  readonly event?: string | undefined;
  readonly data?: readonly string[] | undefined;
  readonly comment?: string | undefined;
  readonly retryMs?: number | undefined;
}

/**
 * Construct a frozen event, defensively copying the data list so later mutation cannot reach inside (SSE-20).
 *
 * @throws InvariantViolation when a field carries a value the grammar can never produce — a NUL-bearing `id`
 *   (SSE-9 drops those at the parser) or a `retryMs` that is not a non-negative safe integer (SSE-11). Both are
 *   programmer errors, not stream conditions: the parser is the only production caller and it filters both.
 *
 * @public
 */
export function makeSseEvent(fields: SseEventFields): SseEvent {
  // Positive and negative space on the two fields the grammar constrains: what must hold, and the impossible
  // value that must be absent.
  invariant(
    fields.retryMs === undefined ||
      (Number.isSafeInteger(fields.retryMs) && fields.retryMs >= 0),
    `retryMs must be a non-negative safe integer when set, got ${String(fields.retryMs)}`,
  );
  invariant(
    !fields.id?.includes('\u0000'),
    'an SSE id containing U+0000 must be dropped by the parser, never carried into an event (SSE-9)',
  );

  return Object.freeze({
    id: fields.id,
    event: fields.event,
    data: Object.freeze([...(fields.data ?? [])]),
    comment: fields.comment,
    retryMs: fields.retryMs,
  });
}

/**
 * Structural equality over all five fields, order-sensitive across `data` (SSE-21).
 *
 * @public
 */
export function sseEventsEqual(a: SseEvent, b: SseEvent): boolean {
  return (
    a.id === b.id &&
    a.event === b.event &&
    a.comment === b.comment &&
    a.retryMs === b.retryMs &&
    a.data.length === b.data.length &&
    a.data.every((line, index) => line === b.data[index])
  );
}

/**
 * True only when every field is unset or empty (SSE-22).
 *
 * A comment counts as content, so a comment-only event reports non-empty — that is the deliberate deviation from
 * strict WHATWG this subsystem replicates, not an oversight.
 *
 * @public
 */
export function isSseEventEmpty(event: SseEvent): boolean {
  return (
    event.id === undefined &&
    event.event === undefined &&
    event.comment === undefined &&
    event.retryMs === undefined &&
    event.data.length === 0
  );
}

/**
 * Stable, identity-free rendering for logs and assertion messages (SSE-21).
 *
 * @public
 */
export function sseEventToString(event: SseEvent): string {
  const parts = [
    `id=${event.id ?? '<absent>'}`,
    `event=${event.event ?? '<absent>'}`,
    `data=[${event.data.join('|')}]`,
    `comment=${event.comment ?? '<absent>'}`,
    `retryMs=${event.retryMs === undefined ? '<absent>' : String(event.retryMs)}`,
  ];
  return `SseEvent(${parts.join(', ')})`;
}
