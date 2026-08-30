// SPDX-License-Identifier: MIT
// packages/core/src/config/identifiers.test.ts
// Exercises: CFG-32 (type-4 UUID with the RFC 4122 version-4/IETF-variant layout, a large batch free
// of collisions, and a named failure when the runtime exposes no WebCrypto).
// CFG-32's concurrency clause has no test: `randomUuid` is synchronous and holds no state, so there
// is nothing to interleave and no assertion that would fail if there were. The argument is carried
// on `randomUuid`'s TSDoc instead. A `Promise.all` over synchronous calls, which is what a test here
// would be, asserts only that `Promise.all` works.
import {describe, expect, test} from 'bun:test';
import {InvariantViolation} from '../invariant.js';
import {randomUuid, randomUuidFrom} from './identifiers.js';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

describe('randomUuid (CFG-32)', () => {
  test('produces the RFC 4122 version-4, IETF-variant layout', () => {
    expect(randomUuid()).toMatch(UUID_V4);
  });

  test('produces 36 characters with hyphens at the canonical offsets', () => {
    const id = randomUuid();

    expect(id).toHaveLength(36);
    expect([id[8], id[13], id[18], id[23]]).toEqual(['-', '-', '-', '-']);
  });

  test('produces no collisions across a large batch', () => {
    const seen = new Set<string>();

    for (let i = 0; i < 10_000; i += 1) seen.add(randomUuid());

    expect(seen.size).toBe(10_000);
  });

  test('names the missing dependency when the runtime exposes no WebCrypto', () => {
    // The random source is passed in rather than read off `globalThis`, so this branch is reachable
    // without deleting or reassigning a global -- which would break parallel execution
    // (`docs/knowledge/harvested/testing.md:50`). Reading `getRandomValues` off `undefined` would otherwise
    // report only `TypeError: Cannot read properties of undefined`.
    expect(() => randomUuidFrom(undefined)).toThrow(InvariantViolation);
    expect(() => randomUuidFrom(undefined)).toThrow(/globalThis\.crypto/u);
    expect(() => randomUuidFrom(undefined)).toThrow(/20\.3/u);
  });

  test('names the missing dependency when WebCrypto carries no getRandomValues', () => {
    expect(() => randomUuidFrom({} as unknown as Crypto)).toThrow(
      InvariantViolation,
    );
  });
});
