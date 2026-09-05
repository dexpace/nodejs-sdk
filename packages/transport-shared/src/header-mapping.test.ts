// SPDX-License-Identifier: MIT
// packages/transport-shared/src/header-mapping.test.ts
// Exercises: TRANSPORT-10 (Content-Type authority), TRANSPORT-11 (framing-header drop set, verbose log),
// TRANSPORT-12 (per-header graceful degradation), TRANSPORT-14 (lenient inbound copy, obs-text preserved, control-byte header dropped)
import {describe, expect, test} from 'bun:test';
import {Headers} from '@dexpace/core';
import {
  CONTROL_BYTE,
  degradeInboundHeaders,
  mapOutboundHeaders,
} from './header-mapping.js';

describe('mapOutboundHeaders', () => {
  test('drops framing headers the native client computes', () => {
    const {sent, dropped} = mapOutboundHeaders(
      Headers.newBuilder()
        .set('Content-Length', '999')
        .set('X-Custom', 'v')
        .build(),
      ['content-length', 'host', 'transfer-encoding'],
    );
    expect(sent.get('content-length')).toBeUndefined();
    expect(sent.get('x-custom')).toBe('v');
    expect(dropped).toContain('content-length');
  });

  test('an explicit Content-Type is never overwritten by a body-derived one', () => {
    const {sent} = mapOutboundHeaders(
      Headers.newBuilder().set('Content-Type', 'text/plain').build(),
      [],
      {bodyDerivedMediaType: 'application/json'},
    );
    expect(sent.get('content-type')).toBe('text/plain');
  });

  test('sets body-derived Content-Type when none is provided', () => {
    const {sent} = mapOutboundHeaders(
      Headers.newBuilder().set('X-Custom', 'v').build(),
      [],
      {bodyDerivedMediaType: 'application/json'},
    );
    expect(sent.get('content-type')).toBe('application/json');
    expect(sent.get('x-custom')).toBe('v');
  });
});

describe('mapOutboundHeaders graceful degradation (TRANSPORT-12)', () => {
  test('a value the outbound grammar rejects drops that header only', () => {
    // `addInbound` is the lenient path (HTTP-19) and admits obs-text; the strict outbound `add`
    // does not. A Headers built from a server response and re-sent is the realistic way a
    // model-valid, wire-invalid value reaches this function.
    const inbound = Headers.newBuilder()
      .addInbound('X-Obs-Text', 'caf\u00e9')
      .add('X-Kept', 'value')
      .build();
    const {sent, dropped} = mapOutboundHeaders(inbound, []);
    expect(sent.get('x-obs-text')).toBeUndefined();
    expect(sent.get('x-kept')).toBe('value');
    expect(dropped).toEqual(['x-obs-text']);
  });

  test('an unusable body-derived media type is dropped rather than failing the mapping', () => {
    const {sent, dropped} = mapOutboundHeaders(
      Headers.newBuilder().set('X-Kept', 'value').build(),
      [],
      {bodyDerivedMediaType: 'text/plain\u0000'},
    );
    expect(sent.get('content-type')).toBeUndefined();
    expect(sent.get('x-kept')).toBe('value');
    expect(dropped).toEqual(['content-type']);
  });
});

describe('CONTROL_BYTE (TRANSPORT-14)', () => {
  // Asserted on the character class itself, not through `degradeInboundHeaders`, because the two
  // gates that reject an inbound value are redundant by construction: the regex below and
  // `Headers.addInbound`'s own `hasForbiddenInboundValueByte`, whose throw the `try`/`catch` turns
  // into the same drop. A value only the second one caught looked identical from outside, which is
  // how `\x0A` stayed out of this class from Phase 8a to audit #67 / #82.
  test('every C0 control byte except HTAB is refused, LF included', () => {
    for (let code = 0x00; code <= 0x1f; code += 1) {
      const value = `v${String.fromCharCode(code)}alue`;
      expect([code, CONTROL_BYTE.test(value)]).toEqual([code, code !== 0x09]);
    }
    expect(CONTROL_BYTE.test('v\x7falue')).toBe(true);
  });

  test('LF is refused whether or not it is preceded by CR', () => {
    // The obs-fold shape (`\r\n ` continuation) and a bare LF are both header injection on the
    // inbound path; RFC 9110 5.5 forbids either from reaching a field value.
    expect(CONTROL_BYTE.test('one\nvalue')).toBe(true);
    expect(CONTROL_BYTE.test('one\r\n two')).toBe(true);
  });

  test('HTAB and obs-text are carried, not refused', () => {
    // TRANSPORT-14's own SHOULD: a non-ASCII byte in a value is preserved rather than stripped, and
    // HTAB is legal whitespace inside a field value (RFC 9110 5.5).
    expect(CONTROL_BYTE.test('one\ttwo')).toBe(false);
    expect(CONTROL_BYTE.test('café')).toBe(false);
  });
});

describe('degradeInboundHeaders', () => {
  test('drops a header whose value carries a line feed, keeps the rest', () => {
    const {headers, dropped} = degradeInboundHeaders([
      ['x-injected', 'value\nx-forged: yes'],
      ['x-good', 'value'],
    ]);
    expect(headers.get('x-injected')).toBeUndefined();
    expect(headers.get('x-forged')).toBeUndefined();
    expect(headers.get('x-good')).toBe('value');
    expect(dropped).toEqual(['x-injected']);
  });

  test('drops a header whose value carries a control byte, keeps the rest', () => {
    const {headers, dropped} = degradeInboundHeaders([
      ['x-bad', 'v\x01alue'],
      ['x-good', 'value'],
    ]);
    expect(headers.get('x-bad')).toBeUndefined();
    expect(headers.get('x-good')).toBe('value');
    expect(dropped).toEqual(['x-bad']);
  });

  test('drops a header whose name carries non-ASCII or control characters', () => {
    const {headers, dropped} = degradeInboundHeaders([
      ['x-bad\x02name', 'value'],
      ['x-bad-café', 'value'],
      ['x-good', 'value'],
    ]);
    expect(headers.get('x-bad\x02name')).toBeUndefined();
    expect(headers.get('x-bad-café')).toBeUndefined();
    expect(headers.get('x-good')).toBe('value');
    expect(dropped).toContain('x-bad\x02name');
    expect(dropped).toContain('x-bad-café');
  });

  test('preserves an obs-text (non-ASCII) byte in a value rather than stripping it', () => {
    const {headers} = degradeInboundHeaders([['x-name', 'café']]);
    expect(headers.get('x-name')).toBe('café');
  });
});
