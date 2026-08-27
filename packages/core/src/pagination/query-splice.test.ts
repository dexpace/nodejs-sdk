// SPDX-License-Identifier: MIT
// packages/core/src/pagination/query-splice.test.ts
// Exercises: PAGE-21 (verbatim splice, untargeted params byte-for-byte), PAGE-22 (RFC 3986 component encoding,
// literal + is data), PAGE-23 (replace-first / append / remove, order preserved), PAGE-24 (non-query components
// preserved exactly).
import {expect, test} from 'bun:test';
import {readQueryParam, spliceQueryParam} from './query-splice.js';

const at = (href: string): URL => new URL(href);
const query = (url: URL): string => url.search.replace(/^\?/, '');

test('untargeted parameters survive byte-for-byte, order preserved (PAGE-21)', () => {
  const out = spliceQueryParam(
    at('https://h/p?flag&filter=a:b&page=1'),
    'page',
    '2',
  );
  expect(query(out)).toBe('flag&filter=a:b&page=2');
});

test('a value-less flag stays value-less', () => {
  const out = spliceQueryParam(at('https://h/p?flag&page=1'), 'page', '2');
  expect(query(out)).toContain('flag&');
  expect(query(out)).not.toContain('flag=');
});

test('reserved characters in untargeted values are not rewritten (PAGE-21)', () => {
  const out = spliceQueryParam(at('https://h/p?a=x:y/z&page=1'), 'page', '2');
  expect(query(out)).toBe('a=x:y/z&page=2');
});

test('a newly-set value uses RFC 3986 component encoding (PAGE-22)', () => {
  expect(query(spliceQueryParam(at('https://h/p'), 'q', 'a b'))).toBe(
    'q=a%20b',
  );
  expect(query(spliceQueryParam(at('https://h/p'), 'token', 'a+b/c='))).toBe(
    'token=a%2Bb%2Fc%3D',
  );
});

test('reading decodes with the same semantics — a literal + reads back as + (PAGE-22)', () => {
  expect(readQueryParam(at('https://h/p?q=a+b'), 'q')).toBe('a+b');
  expect(readQueryParam(at('https://h/p?q=a%20b'), 'q')).toBe('a b');
});

test('a value-less flag reads as the empty string, an absent name as undefined (PAGE-22)', () => {
  expect(readQueryParam(at('https://h/p?flag'), 'flag')).toBe('');
  expect(readQueryParam(at('https://h/p?flag'), 'other')).toBeUndefined();
});

test('reading takes the first match when a name repeats (PAGE-22)', () => {
  expect(readQueryParam(at('https://h/p?page=1&page=9'), 'page')).toBe('1');
});

test('setting replaces the first occurrence in place and drops later duplicates (PAGE-23)', () => {
  expect(
    query(
      spliceQueryParam(at('https://h/p?page=1&sort=asc&page=9'), 'page', '2'),
    ),
  ).toBe('page=2&sort=asc');
});

test('setting an absent parameter appends it (PAGE-23)', () => {
  expect(query(spliceQueryParam(at('https://h/p?sort=asc'), 'page', '2'))).toBe(
    'sort=asc&page=2',
  );
});

test('setting undefined removes the parameter entirely (PAGE-23)', () => {
  expect(
    query(
      spliceQueryParam(at('https://h/p?page=1&sort=asc'), 'page', undefined),
    ),
  ).toBe('sort=asc');
});

test('removing the only parameter leaves an empty query', () => {
  expect(
    query(spliceQueryParam(at('https://h/p?page=1'), 'page', undefined)),
  ).toBe('');
});

test('setting on a URL with no query at all creates one', () => {
  expect(query(spliceQueryParam(at('https://h/p'), 'page', '2'))).toBe(
    'page=2',
  );
});

test('every non-query component is preserved exactly (PAGE-24)', () => {
  const source = at(
    'https://user:pw@host.example:8443/deep/path?page=1&keep=yes#frag',
  );
  const out = spliceQueryParam(source, 'page', '2');
  expect(out.protocol).toBe(source.protocol);
  expect(out.username).toBe(source.username);
  expect(out.password).toBe(source.password);
  expect(out.hostname).toBe(source.hostname);
  expect(out.port).toBe(source.port);
  expect(out.pathname).toBe(source.pathname);
  expect(out.hash).toBe(source.hash);
  expect(query(out)).toBe('page=2&keep=yes');
});

test('the input URL is not mutated', () => {
  const source = at('https://h/p?page=1');
  spliceQueryParam(source, 'page', '2');
  expect(query(source)).toBe('page=1');
});

test('URLSearchParams-style canonicalization does NOT happen (PAGE-21)', () => {
  // URLSearchParams would rewrite `a b` to `a+b` and re-encode `:`; the splice leaves both alone.
  const out = spliceQueryParam(
    at('https://h/p?msg=a%20b&path=x:y&page=1'),
    'page',
    '2',
  );
  expect(query(out)).toBe('msg=a%20b&path=x:y&page=2');
});

test('the WHATWG query encode set is the one boundary of byte-for-byte preservation (PAGE-21)', () => {
  // Assigning to `URL.search` percent-encodes C0 controls, space, " # < > and (on special schemes) ' — so an
  // untargeted segment carrying one of those raw is rewritten. Every such character is one RFC 3986 already
  // requires to be encoded in a query, so the only inputs affected were already non-conformant. Pinned here so
  // the boundary is known rather than discovered, and recorded in the Deviation Ledger.
  const out = spliceQueryParam(at('https://h/p?tag=<raw>&page=1'), 'page', '2');
  expect(query(out)).toBe('tag=%3Craw%3E&page=2');

  // Everything RFC 3986 permits raw in a query survives untouched — which is the case that actually matters.
  const safe = spliceQueryParam(
    at('https://h/p?f=a:b/c!d$e(f)*g,h;i@j&page=1'),
    'page',
    '2',
  );
  expect(query(safe)).toBe('f=a:b/c!d$e(f)*g,h;i@j&page=2');
});

test('stray empty segments are skipped, matching HTTP-31 query parsing', () => {
  expect(
    query(spliceQueryParam(at('https://h/p?a=1&&b=2&page=1'), 'page', '2')),
  ).toBe('a=1&b=2&page=2');
});
