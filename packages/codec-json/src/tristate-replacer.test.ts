// SPDX-License-Identifier: MIT
// packages/codec-json/src/tristate-replacer.test.ts
// Exercises: SERDE-15 (Absent omits the key, Null emits a wire null, Present emits the value — including
// under a key literally named `""`, which a top-level check cannot be distinguished from), SERDE-19
// (installed by default; opt-out is explicit), SERDE-20 (degradation in the two positions that cannot omit
// a key: the top level, resolved in `jsonSerde()` before `JSON.stringify`, and an array element, which
// `JSON.stringify` itself renders as `null`).
import {expect, test} from 'bun:test';
import {absent, nullValue, present} from '@dexpace/core';
import {jsonSerde} from './json-serde.js';
import {tristateReplacer} from './tristate-replacer.js';

const encode = (value: unknown, tristate = true): string =>
  new TextDecoder().decode(jsonSerde({tristate}).serializer.serialize(value));

test('Absent omits the key entirely (SERDE-15)', () => {
  expect(encode({name: 'a', nickname: absent()})).toBe('{"name":"a"}');
});

test('Null emits the key with a wire null (SERDE-15)', () => {
  expect(encode({name: 'a', nickname: nullValue()})).toBe(
    '{"name":"a","nickname":null}',
  );
});

test('Present emits the key with the encoded inner value (SERDE-15)', () => {
  expect(encode({name: 'a', nickname: present('bee')})).toBe(
    '{"name":"a","nickname":"bee"}',
  );
});

test('a Present carrying an object encodes the object, not the wrapper', () => {
  expect(encode({at: present({deep: 1})})).toBe('{"at":{"deep":1}}');
});

test('a nested Tristate inside a Present value is still rewritten', () => {
  expect(encode({at: present({keep: absent(), clear: nullValue()})})).toBe(
    '{"at":{"clear":null}}',
  );
});

test('the wiring is on by default (SERDE-19)', () => {
  expect(
    new TextDecoder().decode(jsonSerde().serializer.serialize({x: absent()})),
  ).toBe('{}');
});

test('opting out is explicit, and then Absent and Null become indistinguishable (SERDE-19)', () => {
  const out = encode({x: absent()}, false);

  // Without the wiring the raw union shape leaks — which is exactly why the option must be named,
  // never silent. The brand is a symbol, so JSON.stringify drops it and only `kind` survives.
  expect(out).toBe('{"x":{"kind":"absent"}}');
  expect(encode({x: nullValue()}, false)).toBe('{"x":{"kind":"null"}}');
});

test('a top-level Absent or Null degrades to a wire null rather than throwing (SERDE-20)', () => {
  expect(encode(absent())).toBe('null');
  expect(encode(nullValue())).toBe('null');
});

test('a top-level Present unwraps to its inner value', () => {
  expect(encode(present(7))).toBe('7');
});

test('an array-element Absent emits null rather than shifting or dropping the element (SERDE-20)', () => {
  // Characterization, not a branch test: the replacer returns `undefined` here exactly as it does for
  // an object key, and `JSON.stringify` renders a dropped ARRAY element as `null` on its own. That
  // platform behaviour is where SERDE-20's array half comes from — see tristate-replacer.ts.
  expect(encode([present(1), absent(), nullValue()])).toBe('[1,null,null]');
});

test('a nested array keeps the same degradation, so indices never shift at depth', () => {
  expect(encode({xs: [absent(), present('a')]})).toBe('{"xs":[null,"a"]}');
});

test('a caller value that merely looks like a Tristate is left alone', () => {
  expect(encode({x: {kind: 'absent'}})).toBe('{"x":{"kind":"absent"}}');
  expect(encode({x: {kind: 'present', value: 1}})).toBe(
    '{"x":{"kind":"present","value":1}}',
  );
});

test('the replacer is exported so a caller can compose their own JSON.stringify call', () => {
  expect(
    JSON.stringify({keep: absent(), clear: nullValue()}, tristateReplacer),
  ).toBe('{"clear":null}');
});

// --- SERDE-15 under a key literally named "" ---------------------------------------------------
//
// `JSON.stringify` calls a replacer with `key === ''` for the top-level value AND for an ordinary
// key that is the empty string. Detecting "top level" as `key === ''` would therefore emit a wire
// `null` for `{"": absent()}` — silently turning "leave unchanged" into "clear", which is exactly
// the corruption SERDE-19 says the wiring exists to prevent. The top-level case resolves in
// `jsonSerde()` before `JSON.stringify` runs, so the replacer never has to guess; these cases pin
// that the replacer treats `""` as an ordinary key at every depth.

test('an Absent under a key named "" is omitted like any other key (SERDE-15)', () => {
  expect(encode({'': absent()})).toBe('{}');
  expect(encode({a: 1, '': absent()})).toBe('{"a":1}');
});

test('a Null under a key named "" still emits the wire null', () => {
  expect(encode({'': nullValue()})).toBe('{"":null}');
});

test('a Present under a key named "" emits its inner value', () => {
  expect(encode({'': present(7)})).toBe('{"":7}');
});

test('the "" key behaves the same at depth and inside an array element', () => {
  expect(encode({x: {'': absent()}})).toBe('{"x":{}}');
  expect(encode([{'': absent()}])).toBe('[{}]');
  expect(encode({xs: [{'': absent(), keep: 1}]})).toBe('{"xs":[{"keep":1}]}');
});

test('a top-level Tristate degrades on every allocation profile, not only through serialize (SERDE-20)', () => {
  // The degradation lives in `jsonSerde()`'s `encodeToText`, which every profile routes through — so
  // the string profile and the byte profile cannot disagree about the root.
  const {serializer} = jsonSerde();

  expect(serializer.serializeToString(absent())).toBe('null');
  expect(new TextDecoder().decode(serializer.serialize(nullValue()))).toBe(
    'null',
  );
  expect(serializer.serializeToString(present(7))).toBe('7');
});

test('the exported replacer leaves the top-level position to the caller, which is documented', () => {
  // The cost of resolving the `""`-key ambiguity: a caller composing their own `JSON.stringify` gets
  // the nested and array-element behaviour but must route through `jsonSerde()` for the top level.
  expect(JSON.stringify(absent(), tristateReplacer)).toBeUndefined();
  // Nested and array positions are unaffected.
  expect(JSON.stringify({keep: absent()}, tristateReplacer)).toBe('{}');
  expect(JSON.stringify([absent()], tristateReplacer)).toBe('[null]');
});

// --- a Tristate nested directly inside a Tristate ----------------------------------------------
//
// `present()` takes `NonNullable<T>` and a Tristate is a non-null object, so `Tristate<Tristate<T>>`
// is well-typed; `tristate(tristate(inner))` builds one on the decode side. A replacer's return
// value is never fed back through the replacer, so a single unwrap would put this SDK's internal
// discriminant — `{"kind":"present","value":1}`, brand symbol and all — on the wire. The walk has to
// run to the bottom, which is what these cases pin.

test('a Present wrapping a Present encodes the innermost value, not the wrapper', () => {
  expect(encode({a: present(present(1))})).toBe('{"a":1}');
  expect(encode({a: present(present(present('x')))})).toBe('{"a":"x"}');
});

test('a Present wrapping an Absent takes the Absent decision for its position', () => {
  expect(encode({a: present(absent()), b: 1})).toBe('{"b":1}');
  expect(encode([present(absent())])).toBe('[null]');
});

test('a Present wrapping a Null emits a wire null', () => {
  expect(encode({a: present(nullValue())})).toBe('{"a":null}');
});

test('the same resolution applies at the top level', () => {
  expect(encode(present(present(1)))).toBe('1');
  expect(encode(present(absent()))).toBe('null');
  expect(encode(present(nullValue()))).toBe('null');
});
