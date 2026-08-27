// SPDX-License-Identifier: MIT
// packages/core/src/redirect/cross-origin.test.ts
// Exercises: REDIR-8 (the RFC 6454 origin tuple -- scheme, case-insensitive host, effective port --
// compared against a fixed SEED origin, never the previous hop; path/query/fragment never participate),
// REDIR-11 (the credential-suppression marker is cleared-then-conditionally-set, so a server-supplied
// Location can never forge an inbound copy into a surviving one).
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {Headers} from '../http/headers.js';
import {
  CROSS_ORIGIN_MARKER_HEADER,
  clearCrossOriginMarker,
  hasCrossOriginMarker,
  isCrossOrigin,
  originOf,
  withCrossOriginMarker,
} from './cross-origin.js';

describe('originOf / isCrossOrigin', () => {
  const seed = originOf(new URL('https://example.com/a'));

  test('identical scheme/host/port is same-origin', () => {
    expect(isCrossOrigin(seed, new URL('https://example.com/b?x=1#y'))).toBe(
      false,
    );
  });

  test('a differing path/query/fragment alone is never cross-origin', () => {
    fc.assert(
      fc.property(fc.webPath(), fc.string(), (path, fragment) => {
        const target = new URL(`https://example.com${path}`);
        target.hash = fragment.replaceAll(/[^\w-]/gu, '');
        expect(isCrossOrigin(seed, target)).toBe(false);
      }),
    );
  });

  test('host comparison is case-insensitive', () => {
    expect(isCrossOrigin(seed, new URL('https://EXAMPLE.com/b'))).toBe(false);
  });

  test('a differing host is cross-origin', () => {
    expect(isCrossOrigin(seed, new URL('https://evil.example/b'))).toBe(true);
  });

  test('a differing scheme is cross-origin even on the same host', () => {
    expect(isCrossOrigin(seed, new URL('http://example.com/b'))).toBe(true);
  });

  test('an explicit default port equals an omitted one', () => {
    expect(isCrossOrigin(seed, new URL('https://example.com:443/b'))).toBe(
      false,
    );
  });

  test('a non-default port is cross-origin', () => {
    expect(isCrossOrigin(seed, new URL('https://example.com:8443/b'))).toBe(
      true,
    );
  });

  test('a bracketed IPv6 literal host round-trips unchanged (REDIR-13)', () => {
    const v6 = originOf(new URL('https://[2001:db8::1]:8443/a'));
    expect(v6.host).toBe('[2001:db8::1]');
    expect(v6.port).toBe(8443);
    expect(isCrossOrigin(v6, new URL('https://[2001:db8::1]:8443/b'))).toBe(
      false,
    );
    expect(isCrossOrigin(v6, new URL('https://[2001:db8::2]:8443/b'))).toBe(
      true,
    );
  });

  test('comparison is against the SEED, not a previous hop', () => {
    // simulates: seed(example.com) -> hop1(other.example, cross-origin) -> hop2(example.com again).
    // Anchored to the seed, hop2 is same-origin again -- which is exactly why the comparison must not
    // walk hop to hop: a foreign host must not be able to hand the credential back to its own origin.
    expect(isCrossOrigin(seed, new URL('https://example.com/final'))).toBe(
      false,
    );
  });
});

describe('the cross-origin marker', () => {
  test('withCrossOriginMarker sets the header to 1', () => {
    const headers = withCrossOriginMarker(Headers.newBuilder().build());
    expect(hasCrossOriginMarker(headers)).toBe(true);
    expect(headers.get(CROSS_ORIGIN_MARKER_HEADER)).toBe('1');
  });

  test('withCrossOriginMarker clears a forged inbound copy before setting its own', () => {
    const forged = Headers.newBuilder()
      .add(CROSS_ORIGIN_MARKER_HEADER, 'anything')
      .build();
    const marked = withCrossOriginMarker(forged);
    expect(marked.getAll(CROSS_ORIGIN_MARKER_HEADER)).toEqual(['1']);
  });

  test('clearCrossOriginMarker removes it', () => {
    const marked = withCrossOriginMarker(Headers.newBuilder().build());
    expect(hasCrossOriginMarker(clearCrossOriginMarker(marked))).toBe(false);
  });

  test('clearCrossOriginMarker is idempotent when already absent', () => {
    const bare = Headers.newBuilder().build();
    expect(hasCrossOriginMarker(clearCrossOriginMarker(bare))).toBe(false);
  });

  test('hasCrossOriginMarker is false when never set', () => {
    expect(hasCrossOriginMarker(Headers.newBuilder().build())).toBe(false);
  });
});
