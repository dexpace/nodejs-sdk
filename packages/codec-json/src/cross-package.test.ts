// SPDX-License-Identifier: MIT
// packages/codec-json/src/cross-package.test.ts
// Exercises: SERDE-2 (core's serdeBody stamps the codec's own declared media type across the package
// boundary), SERDE-15 (a core-built Tristate keeps PATCH semantics through the codec), SEAM-1/NFR-2 (the
// codec's only edge to core is a peer, so brand identity has to survive that boundary).
//
// Guards the dual-package hazard sdk-design-nodejs/02 §2 describes. A `Tristate` constructed in @dexpace/core
// must be recognized by codec-json's replacer. Two non-identical copies of core in one tree would mean two
// distinct brand symbols and a silently wrong wire payload — a key emitted that the caller asked to omit.
import {expect, test} from 'bun:test';
import {
  absent,
  isTristate,
  nullValue,
  present,
  serdeBody,
  TRISTATE_BRAND,
} from '@dexpace/core';
import {jsonSerde} from './json-serde.js';

test('the brand symbol is registry-global, so two copies of core still agree', () => {
  // Compared in this direction because `TRISTATE_BRAND` is a `unique symbol`: a plain `symbol` is
  // not assignable to it, so it has to be the expectation rather than the subject.
  expect(Symbol.for('@dexpace/core.Tristate')).toBe(TRISTATE_BRAND);
});

test('a Tristate constructed in core is recognized by codec-json', () => {
  expect(isTristate(absent())).toBe(true);
  expect(isTristate(nullValue())).toBe(true);
  expect(isTristate(present(1))).toBe(true);
});

test('a core-constructed Tristate round-trips through the codec with PATCH semantics intact', () => {
  const encoded = new TextDecoder().decode(
    jsonSerde().serializer.serialize({
      keep: absent(),
      clear: nullValue(),
      set: present('v'),
    }),
  );

  expect(encoded).toBe('{"clear":null,"set":"v"}');
});

test('a caller object that merely has a kind field is not mistaken for a Tristate', () => {
  const decoy = {kind: 'absent'};

  expect(isTristate(decoy)).toBe(false);
  expect(
    new TextDecoder().decode(jsonSerde().serializer.serialize({x: decoy})),
  ).toBe('{"x":{"kind":"absent"}}');
});

test("core's serdeBody drives this codec end to end, stamping the codec's own media type (SERDE-2)", () => {
  // The other direction of the same boundary: core consuming the codec through the `Serde` seam,
  // rather than the codec consuming core's `Tristate`.
  const body = serdeBody({name: 'ada', nickname: absent()}, jsonSerde());

  expect(body.mediaType).toBe('application/json');
  expect(body.contentLength).toBe(
    new TextEncoder().encode('{"name":"ada"}').length,
  );
  expect(body.replayable).toBe(true);
});
