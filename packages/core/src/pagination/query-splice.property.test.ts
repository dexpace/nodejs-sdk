// SPDX-License-Identifier: MIT
// packages/core/src/pagination/query-splice.property.test.ts
import {expect, test} from 'bun:test';
import fc from 'fast-check';
import {UrlConstructionError} from '../http/errors.js';
import {readQueryParam, spliceQueryParam} from './query-splice.js';

/**
 * Segment names and values drawn from characters a real server actually sends, including hostile ones.
 *
 * The alphabet deliberately excludes `"`, `#`, `<`, `>`, and `'`: those sit in the WHATWG query percent-encode
 * set, so assigning to `URL.search` rewrites them and byte-for-byte preservation genuinely does not hold. That
 * boundary is pinned by its own named test above rather than being smuggled into a property that would then
 * fail for a reason unrelated to the splice logic this property exists to check.
 */
const rawSegment = fc
  .tuple(
    fc.stringMatching(/^[a-z]{1,6}$/),
    fc.stringMatching(/^[a-zA-Z0-9:%._~-]{0,10}$/),
  )
  .map(([name, value]) => `${name}=${value}`);

test('every untargeted segment survives the splice byte-for-byte (PAGE-21)', () => {
  fc.assert(
    fc.property(
      fc.array(rawSegment, {maxLength: 6}),
      fc.string({minLength: 1}),
      (segments, newValue) => {
        const untargeted = segments.filter(s => !s.startsWith('page='));
        const url = new URL(
          `https://h/p?${[...untargeted, 'page=1'].join('&')}`,
        );
        const out = spliceQueryParam(url, 'page', newValue);
        const outSegments = out.search.replace(/^\?/, '').split('&');
        return untargeted.every(
          (segment, index) => outSegments[index] === segment,
        );
      },
    ),
  );
});

test('write-then-read is the identity for any value (PAGE-22)', () => {
  fc.assert(
    fc.property(fc.string(), value => {
      const url = spliceQueryParam(
        new URL('https://h/p?a=1&b=2'),
        'cursor',
        value,
      );
      return readQueryParam(url, 'cursor') === value;
    }),
  );
});

/**
 * Strings that mix ordinary query text with UNPAIRED surrogate code units — the same generator
 * `http/query-params.test.ts` uses, for the same reason: `fc.string()`'s default unit is printable
 * ASCII, so the `URIError` path would otherwise go ungenerated. That is exactly why the identity
 * property above never caught it.
 */
const surrogateBearingString = fc.string({
  unit: fc.oneof(
    fc.constantFrom('a', 'b', ' ', '=', '&', '%', '+', '\u{1F600}'),
    fc
      .integer({min: 0xd800, max: 0xdfff})
      .map(code => String.fromCharCode(code)),
  ),
  maxLength: 8,
});

test('no URIError escapes the splice or the read, whatever a server sent (PAGE-22)', () => {
  fc.assert(
    fc.property(
      surrogateBearingString,
      surrogateBearingString,
      (name, value) => {
        const url = new URL('https://h/p?a=1');
        try {
          const out = spliceQueryParam(url, name, value);
          expect(readQueryParam(out, name)).toBe(value);
        } catch (e: unknown) {
          // The one sanctioned failure: inside the error tree, from the call that was handed the
          // value. A `URIError` here means the guard was bypassed.
          expect(e).toBeInstanceOf(UrlConstructionError);
        }
      },
    ),
    {numRuns: 500},
  );
});
