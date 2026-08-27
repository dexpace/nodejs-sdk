// SPDX-License-Identifier: MIT
// packages/core/src/pagination/link-header.test.ts
// Exercises: PAGE-18 (RFC 5988/8288 link-value parsing — commas inside <> or quotes do not split, quoted-pair
// escapes, quoted/unquoted rel, multi-token rel, case-insensitive `next`), PAGE-20 (multiple header instances).
import {expect, test} from 'bun:test';
import {findNextLink, parseLinkHeader} from './link-header.js';

test('a simple rel=next is found', () => {
  expect(findNextLink(['</p?page=2>; rel="next"'])).toBe('/p?page=2');
});

test('an unquoted rel works (PAGE-18)', () => {
  expect(findNextLink(['</p?page=2>; rel=next'])).toBe('/p?page=2');
});

test('rel matching is case-insensitive (PAGE-18)', () => {
  expect(findNextLink(['</p?page=2>; rel="NEXT"'])).toBe('/p?page=2');
});

test('a multi-token rel containing next matches (PAGE-18)', () => {
  expect(findNextLink(['</p?page=2>; rel="prev next last"'])).toBe('/p?page=2');
});

test('a tab-separated multi-token rel matches (PAGE-18)', () => {
  expect(findNextLink(['</p?page=2>; rel="prev\tnext"'])).toBe('/p?page=2');
});

test('the FIRST link-value whose rel contains next wins (PAGE-18)', () => {
  expect(findNextLink(['</a>; rel="next", </b>; rel="next"'])).toBe('/a');
});

test('rel=prev and rel=last decoys are skipped (PAGE-18)', () => {
  expect(
    findNextLink(['</a>; rel="prev", </b>; rel="last", </c>; rel="next"']),
  ).toBe('/c');
});

test('a comma inside the angle-bracketed URL does not split link-values (PAGE-18)', () => {
  expect(findNextLink(['</p?ids=1,2,3>; rel="next"'])).toBe('/p?ids=1,2,3');
});

test('a comma inside a quoted parameter value does not split link-values (PAGE-18)', () => {
  const parsed = parseLinkHeader(
    '</a>; title="one, two"; rel="next", </b>; rel="prev"',
  );
  expect(parsed).toHaveLength(2);
  expect(parsed[0]?.target).toBe('/a');
});

test('a quoted-pair escape is honored (PAGE-18)', () => {
  const parsed = parseLinkHeader('</a>; title="say \\"hi\\", ok"; rel="next"');
  expect(parsed).toHaveLength(1);
  expect(parsed[0]?.rel).toContain('next');
});

test('no Link header means end of stream (PAGE-18)', () => {
  expect(findNextLink([])).toBeUndefined();
});

test('a Link header with no rel=next means end of stream (PAGE-18)', () => {
  expect(findNextLink(['</a>; rel="prev"'])).toBeUndefined();
});

test('multiple separate Link header instances are normalized by concatenation (PAGE-20)', () => {
  expect(findNextLink(['</a>; rel="last"', '</b>; rel="next"'])).toBe('/b');
});

test('an empty header set maps to no next link (PAGE-20)', () => {
  expect(findNextLink([''])).toBeUndefined();
});

test('surrounding whitespace is tolerated', () => {
  expect(
    findNextLink([
      '  < /p?page=2 > ;  rel = "next"  '.replace(/ (?=[/>])|(?<=<) /g, ''),
    ]),
  ).toBe('/p?page=2');
});
