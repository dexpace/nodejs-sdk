// SPDX-License-Identifier: MIT
// packages/core/src/http/headers.test.ts
// Exercises: XCUT-18 (header name/value validation is the request-splitting defense, and it lives at the
// transport-agnostic model layer so no transport can be reached with a CR/LF-bearing header: names reject
// every C0 control byte INCLUDING HTAB plus DEL and non-ASCII; outbound values reject the same set EXCEPT
// HTAB; inbound values are lenient about obs-text but still reject control bytes),
// HTTP-13 (case-insensitive storage), HTTP-14 (multi-value add/set), HTTP-15 (null removes),
// HTTP-16 (insertion order), HTTP-3 (newBuilder derivation doesn't alias), HTTP-5 (no live-builder leak),
// XCUT-15's ingested-collection clause (a builder defensively copies what it is handed, so mutating that
// collection after build() cannot alter the built model, and a derived builder never aliases its source),
// HTTP-17 (outbound name validation + trim), HTTP-18 (outbound value validation), HTTP-19 (inbound leniency),
// HTTP-20 (no value echo, escaped name), HTTP-21 (typed HeaderName interop),
// HTTP-5 again (getAll returns a FROZEN list on both the present-name and the absent-name path),
// HTTP-13 once more (Headers.equals asserted directly, not only through Request.equals)
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {Headers, HeaderName} from './headers.js';

describe('case-insensitive storage', () => {
  test('a name added under one casing resolves under any other', () => {
    const headers = Headers.newBuilder()
      .add('Content-Type', 'text/plain')
      .build();
    expect(headers.get('content-type')).toBe('text/plain');
    expect(headers.get('CONTENT-TYPE')).toBe('text/plain');
    expect(headers.has('cOnTeNt-TyPe')).toBe(true);
  });

  test('folds using an ASCII-only rule, not a locale-sensitive one', () => {
    const headers = Headers.newBuilder().add('X-Trace-I', 'v').build();
    expect(headers.has('x-trace-i')).toBe(true);
  });
});

describe('multi-value semantics', () => {
  test('add appends, set replaces the whole list', () => {
    const headers = Headers.newBuilder()
      .add('X-Tag', 'a')
      .add('X-Tag', 'b')
      .build();
    expect(headers.getAll('X-Tag')).toEqual(['a', 'b']);

    const replaced = headers.newBuilder().set('X-Tag', 'c').build();
    expect(replaced.getAll('X-Tag')).toEqual(['c']);
  });
});

describe('null removes', () => {
  test('setting a header value to null removes it entirely', () => {
    const headers = Headers.newBuilder()
      .add('X-Tag', 'a')
      .set('X-Tag', null)
      .build();
    expect(headers.has('X-Tag')).toBe(false);
  });
});

describe('insertion order', () => {
  test('distinct names iterate in insertion order', () => {
    const headers = Headers.newBuilder()
      .add('X-First', '1')
      .add('X-Second', '2')
      .add('X-Third', '3')
      .build();
    expect(headers.names()).toEqual(['X-First', 'X-Second', 'X-Third']);
  });
});

describe('newBuilder derivation', () => {
  test('mutating a derived builder does not affect the original', () => {
    const original = Headers.newBuilder().add('X-Tag', 'a').build();

    original.newBuilder().add('X-Tag', 'b').build();

    expect(original.getAll('X-Tag')).toEqual(['a']);
  });

  test('a previously-returned snapshot is unchanged after the source builder mutates further', () => {
    const builder = Headers.newBuilder().add('X-Tag', 'a');
    const first = builder.build();
    builder.add('X-Tag', 'b');
    const second = builder.build();

    expect(first.getAll('X-Tag')).toEqual(['a']);
    expect(second.getAll('X-Tag')).toEqual(['a', 'b']);
  });
});

describe('outbound name validation (HTTP-17)', () => {
  test('rejects a blank name', () => {
    expect(() => Headers.newBuilder().add('', 'v')).toThrow();
  });

  test('rejects a name with CR/LF or NUL', () => {
    expect(() => Headers.newBuilder().add('a\r\nb', 'v')).toThrow();
    expect(() => Headers.newBuilder().add('a\0b', 'v')).toThrow();
  });

  test('rejects a non-ASCII name', () => {
    expect(() => Headers.newBuilder().add('héader', 'v')).toThrow();
  });

  test('trims surrounding whitespace and stores the trimmed form', () => {
    const headers = Headers.newBuilder().add('  X-Trace  ', 'v').build();
    expect(headers.names()).toEqual(['X-Trace']);
  });
});

describe('outbound value validation (HTTP-18)', () => {
  test('rejects CR/LF and NUL in a value', () => {
    expect(() => Headers.newBuilder().add('X-Tag', 'a\r\nb')).toThrow();
    expect(() => Headers.newBuilder().add('X-Tag', 'a\0b')).toThrow();
  });

  test('rejects a non-ASCII value', () => {
    expect(() => Headers.newBuilder().add('X-Tag', 'vålue')).toThrow();
  });

  test('accepts HTAB in a value', () => {
    expect(() => Headers.newBuilder().add('X-Tag', 'a\tb')).not.toThrow();
  });
});

describe('inbound leniency (HTTP-19)', () => {
  test('permits a non-ASCII (obs-text) inbound value that outbound would reject', () => {
    const headers = Headers.newBuilder()
      .addInbound('Content-Disposition', 'café')
      .build();
    expect(headers.get('content-disposition')).toBe('café');
  });

  test('still rejects a control character in an inbound value', () => {
    expect(() => Headers.newBuilder().addInbound('X-Tag', 'a\r\nb')).toThrow();
  });

  test('inbound names remain strictly validated', () => {
    expect(() => Headers.newBuilder().addInbound('héader', 'v')).toThrow();
  });
});

describe('error messages never leak (HTTP-20)', () => {
  test('a rejected value never appears in the thrown message', () => {
    try {
      Headers.newBuilder().add('X-Tag', 'secret-value-abc\r\n');
      throw new Error('expected add() to throw');
    } catch (e) {
      expect((e as Error).message).not.toContain('secret-value-abc');
    }
  });

  test('a rejected name with an embedded CR appears escaped, not raw', () => {
    try {
      Headers.newBuilder().add('a\rb', 'v');
      throw new Error('expected add() to throw');
    } catch (e) {
      expect((e as Error).message).not.toContain('\r');
      expect((e as Error).message).toContain('\\r');
    }
  });
});

describe('HeaderName (HTTP-21)', () => {
  test('compares by case-folded form while preserving original casing', () => {
    const a = HeaderName.of('Content-Type');
    const b = HeaderName.of('content-type');
    expect(a.equals(b)).toBe(true);
    expect(a.raw).toBe('Content-Type');
  });

  test('is interchangeable with the string-keyed API in both directions', () => {
    const typedAdded = Headers.newBuilder()
      .add(HeaderName.of('X-Trace'), 'v')
      .build();
    expect(typedAdded.get('x-trace')).toBe('v');

    const stringAdded = Headers.newBuilder().add('X-Trace', 'v').build();
    expect(stringAdded.get(HeaderName.of('x-TRACE'))).toBe('v');
    expect(stringAdded.has(HeaderName.of('X-Trace'))).toBe(true);
  });

  test('enforces the same name validation as HTTP-17', () => {
    expect(() => HeaderName.of('a\r\nb')).toThrow();
  });
});

describe('case-fold property (HTTP-13)', () => {
  test('a name added under any casing resolves under every other casing', () => {
    const nameArb = fc.stringMatching(/^[A-Za-z][A-Za-z0-9-]{0,19}$/);
    const valueArb = fc.stringMatching(/^[\x20-\x7e]{0,20}$/);
    fc.assert(
      fc.property(nameArb, valueArb, (name, value) => {
        const headers = Headers.newBuilder().add(name, value).build();
        expect(headers.get(name.toLowerCase())).toBe(value);
        expect(headers.get(name.toUpperCase())).toBe(value);
        expect(headers.has(name)).toBe(true);
      }),
    );
  });
});

describe('entries() (HTTP-14/16, HTTP-5)', () => {
  test('flattens every name/value pair in insertion order, preserving original casing', () => {
    const headers = Headers.newBuilder()
      .add('X-Tag', 'a')
      .add('X-Tag', 'b')
      .add('Content-Type', 'text/plain')
      .build();
    expect(headers.entries()).toEqual([
      ['X-Tag', 'a'],
      ['X-Tag', 'b'],
      ['Content-Type', 'text/plain'],
    ]);
  });

  test('is empty for empty headers, and a returned snapshot never reaches the model', () => {
    expect(Headers.newBuilder().build().entries()).toEqual([]);

    const headers = Headers.newBuilder().add('X-Tag', 'a').build();
    const snapshot = headers.entries() as [string, string][];
    snapshot.push(['X-Injected', 'v']);
    expect(headers.entries()).toHaveLength(1);
  });
});

describe('setInbound (HTTP-19)', () => {
  test('replaces the whole value list under the lenient inbound rule', () => {
    const headers = Headers.newBuilder()
      .addInbound('X-Tag', 'a')
      .addInbound('X-Tag', 'b')
      .setInbound('X-Tag', 'café')
      .build();
    expect(headers.getAll('X-Tag')).toEqual(['café']);
  });

  test('a null value removes the header, exactly like the outbound set', () => {
    const headers = Headers.newBuilder()
      .addInbound('X-Tag', 'a')
      .setInbound('X-Tag', null)
      .build();
    expect(headers.has('X-Tag')).toBe(false);
  });

  test('still rejects a control character in the value and a non-ASCII name', () => {
    expect(() => Headers.newBuilder().setInbound('X-Tag', 'a\r\nb')).toThrow();
    expect(() => Headers.newBuilder().setInbound('héader', 'v')).toThrow();
  });
});

describe('HeaderName.lowerCased (HTTP-21)', () => {
  test('exposes the case-folded form the model keys on, alongside the raw casing', () => {
    const name = HeaderName.of('  Content-Type  ');
    expect(name.lowerCased).toBe('content-type');
    expect(name.raw).toBe('Content-Type');
  });
});

describe('getAll returns a frozen list on every path (HTTP-5)', () => {
  const headers = Headers.newBuilder()
    .add('X-Tag', 'a')
    .add('X-Tag', 'b')
    .build();

  test('the present-name list is frozen', () => {
    // Asserted directly for the first time by audit #67 / #76. `build()` freezes each value list,
    // and `getAll` returns that same reference rather than a copy, so the freeze is the whole of
    // HTTP-5's "cannot mutate the model through the returned value" on this accessor — if the
    // freeze were ever dropped, nothing else would notice.
    const values = headers.getAll('X-Tag');
    expect(Object.isFrozen(values)).toBe(true);
    expect(() => (values as string[]).push('c')).toThrow(TypeError);
    expect(headers.getAll('X-Tag')).toEqual(['a', 'b']);
  });

  test('the absent-name list is frozen too, and is the same shared instance', () => {
    // It was a fresh `[]` — unfrozen, against the TSDoc's promise of a frozen list, and a fresh
    // allocation on every miss.
    const first = headers.getAll('nope');
    const second = headers.getAll('also-nope');
    expect(Object.isFrozen(first)).toBe(true);
    expect(first).toBe(second);
    expect(() => (first as string[]).push('x')).toThrow(TypeError);
  });
});

// Reached only through `Request.equals` until audit #67 / #76. Each case below is a way the
// comparison could be wrong that a Request-level test would not isolate.
function buildHeaders(pairs: readonly (readonly [string, string])[]): Headers {
  const builder = Headers.newBuilder();
  for (const [name, value] of pairs) builder.add(name, value);
  return builder.build();
}

describe('Headers.equals directly (HTTP-13): names and casing', () => {
  test('is reflexive and true for an identical construction', () => {
    const a = buildHeaders([['X-A', '1']]);
    expect(a.equals(a)).toBe(true);
    expect(a.equals(buildHeaders([['X-A', '1']]))).toBe(true);
  });

  test('name casing does not participate — HTTP-13 folds names', () => {
    expect(
      buildHeaders([['X-A', '1']]).equals(buildHeaders([['x-a', '1']])),
    ).toBe(true);
  });

  test('value casing DOES participate — only names are folded', () => {
    expect(
      buildHeaders([['X-A', 'v']]).equals(buildHeaders([['X-A', 'V']])),
    ).toBe(false);
  });

  test('the order of distinct NAMES does not matter', () => {
    const ab = buildHeaders([
      ['X-A', '1'],
      ['X-B', '2'],
    ]);
    const ba = buildHeaders([
      ['X-B', '2'],
      ['X-A', '1'],
    ]);
    expect(ab.equals(ba)).toBe(true);
    expect(ba.equals(ab)).toBe(true);
  });
});

describe('Headers.equals directly (HTTP-13): values, order and subsets', () => {
  test('the order of VALUES under one name does matter (HTTP-14)', () => {
    const ab = buildHeaders([
      ['X-T', 'a'],
      ['X-T', 'b'],
    ]);
    const ba = buildHeaders([
      ['X-T', 'b'],
      ['X-T', 'a'],
    ]);
    expect(ab.equals(ba)).toBe(false);
  });

  test('a strict subset is not equal, in either direction', () => {
    const one = buildHeaders([['X-A', '1']]);
    const two = buildHeaders([
      ['X-A', '1'],
      ['X-B', '2'],
    ]);
    expect(one.equals(two)).toBe(false);
    expect(two.equals(one)).toBe(false);
  });

  test('same name count, disjoint names, is not equal', () => {
    // The length pre-check passes here, so this is the case that proves the per-name lookup runs.
    expect(
      buildHeaders([['X-A', '1']]).equals(buildHeaders([['X-B', '1']])),
    ).toBe(false);
  });

  test('same names with different value COUNTS is not equal', () => {
    const one = buildHeaders([['X-T', 'a']]);
    const two = buildHeaders([
      ['X-T', 'a'],
      ['X-T', 'a'],
    ]);
    expect(one.equals(two)).toBe(false);
    expect(two.equals(one)).toBe(false);
  });

  test('two empty instances are equal', () => {
    expect(
      Headers.newBuilder().build().equals(Headers.newBuilder().build()),
    ).toBe(true);
  });
});
