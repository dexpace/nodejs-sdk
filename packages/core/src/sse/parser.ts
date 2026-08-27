// SPDX-License-Identifier: MIT
// packages/core/src/sse/parser.ts
import type {BufferedSource} from '../io/buffered-source.js';
import {makeSseEvent, type SseEvent} from './event.js';
import {SSE_END, SseLineReader} from './line-reader.js';

/**
 * The documented cap for `retry` (SSE-11).
 *
 * `SSE-11` requires a port to pick a cap and reject beyond it "rather than wrap." In JavaScript the wrapping
 * hazard is silent rounding, not overflow: past 2^53−1 an integer literal no longer round-trips, so a larger
 * value would parse to a *different* number than the server sent. Reject instead.
 */
const MAX_RETRY_MS = Number.MAX_SAFE_INTEGER;

interface BlockState {
  id: string | undefined;
  event: string | undefined;
  data: string[];
  comment: string | undefined;
  retryMs: number | undefined;
  sawAnyField: boolean;
}

function emptyBlock(): BlockState {
  return {
    id: undefined,
    event: undefined,
    data: [],
    comment: undefined,
    retryMs: undefined,
    sawAnyField: false,
  };
}

/**
 * The WHATWG SSE line/field grammar as a state machine (SSE-1, SSE-3–SSE-16).
 *
 * A class rather than a generator, for two reasons the spec forces: SSE-15 requires the end sentinel to stay
 * stable across repeated pulls, and SSE-16 requires exactly one piece of state (BOM-consumed) to persist while
 * the last-event-id explicitly does **not**. A generator would also make SSE-17's "must not own or close the
 * source" the harder thing to guarantee, since a `finally` is the natural place to clean up. Ownership is
 * introduced one layer up, by the stream facade.
 *
 * Deliberately deviates from strict WHATWG in three ways the spec mandates replicating: comments are exposed,
 * dispatch is permissive (any field set emits), and a pending block dispatches at EOF without a blank line.
 *
 * @internal
 */
export class SseParser {
  readonly #lines: SseLineReader;
  #block = emptyBlock();
  #ended = false;

  constructor(
    source: BufferedSource,
    options?: {maxLineBytes?: number | undefined},
  ) {
    this.#lines = new SseLineReader(source, options?.maxLineBytes);
  }

  async next(): Promise<SseEvent | typeof SSE_END> {
    if (this.#ended) return SSE_END;

    for (;;) {
      const line = await this.#lines.nextLine();

      if (line === SSE_END) {
        this.#ended = true;
        // SSE-14: a pending block dispatches at EOF even with no terminating blank line.
        return this.#block.sawAnyField ? this.#dispatch() : SSE_END;
      }

      if (line === '') {
        // SSE-1: the dispatch boundary. SSE-13: a block with no field set is skipped, not emitted.
        if (this.#block.sawAnyField) return this.#dispatch();
        this.#block = emptyBlock();
        continue;
      }

      this.#consumeLine(line);
    }
  }

  #dispatch(): SseEvent {
    const block = this.#block;
    this.#block = emptyBlock();
    return makeSseEvent({
      id: block.id,
      event: block.event,
      data: block.data,
      comment: block.comment,
      retryMs: block.retryMs,
    });
  }

  #consumeLine(line: string): void {
    if (line.startsWith(':')) {
      // SSE-6: a comment. Latest-wins, and it counts as a field seen, so a comment-only block dispatches.
      this.#block.comment = stripOneLeadingSpace(line.slice(1));
      this.#block.sawAnyField = true;
      return;
    }

    // SSE-3: split at the FIRST colon. No colon → the whole line is the name with an empty value.
    const colon = line.indexOf(':');
    const name = colon === -1 ? line : line.slice(0, colon);
    const rawValue = colon === -1 ? '' : line.slice(colon + 1);
    const value = stripOneLeadingSpace(rawValue);

    switch (name) {
      case 'data':
        this.#block.data.push(value);
        this.#block.sawAnyField = true;
        return;
      case 'event':
        this.#block.event = value;
        this.#block.sawAnyField = true;
        return;
      case 'id':
        // SSE-9: an id containing NUL is ignored ENTIRELY — it does not set the id, does not count as a field
        // seen, and does not overwrite a valid id already seen in this block.
        if (!value.includes('\u0000')) {
          this.#block.id = value;
          this.#block.sawAnyField = true;
        }
        return;
      case 'retry': {
        const parsed = parseRetry(value);
        if (parsed !== undefined) {
          this.#block.retryMs = parsed;
          this.#block.sawAnyField = true;
        }
        return;
      }
      default:
        // SSE-7: any other field name is silently discarded — no state, no dispatch.
        return;
    }
  }
}

/** SSE-5: strip exactly one leading U+0020 if present; further leading spaces are content. */
function stripOneLeadingSpace(value: string): string {
  return value.startsWith(' ') ? value.slice(1) : value;
}

/** SSE-11: accept only all-ASCII-digit values within the documented cap; anything else is ignored. */
function parseRetry(value: string): number | undefined {
  if (value.length === 0 || !/^[0-9]+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= MAX_RETRY_MS
    ? parsed
    : undefined;
}
