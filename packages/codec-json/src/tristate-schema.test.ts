// SPDX-License-Identifier: MIT
// packages/codec-json/src/tristate-schema.test.ts
// Exercises: SERDE-16 (missing → Absent, explicit null → Null, value → Present with element type preserved),
// SERDE-17 (a missing key resolves to Absent via the combinator's own default, not a JSON.parse reviver),
// SERDE-29 (both combinators return frozen schemas, so a shared schema cannot acquire state).
import {expect, test} from 'bun:test';
import {valueOrNull, type Schema, type Tristate} from '@dexpace/core';
import {expectTypeOf} from 'expect-type';
import {MISSING, tristate, tristateObject} from './tristate-schema.js';

/** A witness that validates nothing — these cases are about key resolution, not value shape. */
const identity: Schema<unknown> = {parse: input => input};

const numberSchema: Schema<number> = {
  parse(input: unknown): number {
    if (typeof input !== 'number') throw new Error('not a number');
    return input;
  },
};

const stringSchema: Schema<string> = {
  parse(input: unknown): string {
    if (typeof input !== 'string') throw new Error('not a string');
    return input;
  },
};

test('an explicit null decodes to Null (SERDE-16)', () => {
  expect(tristate(numberSchema).parse(null).kind).toBe('null');
});

test('a present value decodes to Present with the inner schema applied (SERDE-16)', () => {
  const decoded = tristate(numberSchema).parse(5);

  // Assert the fields directly. Spreading `decoded` into its own expectation would be a tautology
  // that passes for any input.
  expect(decoded.kind).toBe('present');
  expect(decoded.kind === 'present' ? decoded.value : undefined).toBe(5);
});

test('the inner schema still rejects a wrong-typed present value', () => {
  expect(() => tristate(numberSchema).parse('5')).toThrow();
});

test('the missing sentinel decodes to Absent (SERDE-17)', () => {
  expect(tristate(numberSchema).parse(MISSING).kind).toBe('absent');
});

test('undefined also decodes to Absent, so a hand-built object literal behaves the same way', () => {
  expect(tristate(numberSchema).parse(undefined).kind).toBe('absent');
});

test('tristateObject maps a missing key to Absent and a present key through the field schema (SERDE-17)', () => {
  const schema = tristateObject({age: numberSchema});

  expect(schema.parse({}).age.kind).toBe('absent');
  expect(schema.parse({age: null}).age.kind).toBe('null');
  const decoded = schema.parse({age: 30}).age;
  expect(decoded.kind === 'present' ? decoded.value : undefined).toBe(30);
});

test('an explicitly-undefined key is Absent, not Null — the key exists but carried no wire value', () => {
  expect(
    tristateObject({age: numberSchema}).parse({age: undefined}).age.kind,
  ).toBe('absent');
});

test('tristateObject leaves non-tristate keys untouched at runtime', () => {
  const schema = tristateObject({age: numberSchema});

  const parsed = schema.parse({age: 1, other: 'kept'});

  expect(parsed.age.kind).toBe('present');
  // `as Record<string, unknown>`: the pass-through keys are still THERE at runtime; the return type
  // deliberately names only the `shape` keys, so reaching one is the caller's explicit widening.
  // An index signature on the return type would have made every misspelled key compile silently.
  expect((parsed as Record<string, unknown>).other).toBe('kept');
});

test('tristateObject does not mutate the object it was handed', () => {
  const schema = tristateObject({age: numberSchema});
  const source = {age: 1, other: 'kept'};

  schema.parse(source);

  expect(source.age).toBe(1);
});

test('tristateObject rejects a non-object input rather than producing an empty shape', () => {
  const schema = tristateObject({age: numberSchema});

  expect(() => schema.parse(null)).toThrow(TypeError);
  expect(() => schema.parse('not an object')).toThrow(TypeError);
  expect(() => schema.parse(7)).toThrow(TypeError);
});

test('a field schema rejection propagates out of tristateObject', () => {
  expect(() =>
    tristateObject({age: numberSchema}).parse({age: 'thirty'}),
  ).toThrow();
});

test("tristateObject preserves each field's element type through the mapped return (SERDE-16)", () => {
  // `tristateObject`'s return is a mapped-plus-conditional type built behind an `as never`, so a
  // runtime test cannot catch an inference regression here — only `expectTypeOf` can
  // (docs/knowledge/harvested/testing.md:30).
  const parsed = tristateObject({age: numberSchema, name: stringSchema}).parse(
    {},
  );

  expectTypeOf(parsed.age).toEqualTypeOf<Tristate<number>>();
  expectTypeOf(parsed.name).toEqualTypeOf<Tristate<string>>();
  // A key the shape never named is NOT reachable: the return type carries no index signature, so a
  // misspelling is a compile error rather than a silent `unknown`. The pass-through keys still exist
  // at runtime — a caller who wants them typed intersects at their own call site, where the DTO's
  // real shape is known.
  // @ts-expect-error — unnamed keys are absent from the mapped return type by design
  const unreachable: unknown = parsed.somethingElse;
  expect(unreachable).toBeUndefined();
});

// --- SERDE-17: a missing key resolves to Absent, whatever it is NAMED --------------------------
//
// `key in source` walks the prototype chain, and `JSON.parse` hands back objects rooted at
// `Object.prototype`. A field named after any of its eleven members therefore read as
// PRESENT-of-a-native-function when the wire had omitted it. `Object.hasOwn` is the fix; these
// cases pin it per name so a revert is loud.

const PROTOTYPE_MEMBERS = Object.getOwnPropertyNames(Object.prototype).filter(
  name => name !== '__proto__',
);

test('a wire-omitted field named after an Object.prototype member is Absent, not Present (SERDE-17)', () => {
  const shape = Object.fromEntries(
    PROTOTYPE_MEMBERS.map(name => [name, identity]),
  );
  // `JSON.parse`, not a literal: the prototype chain is the whole point of this case.
  const parsed = tristateObject(shape).parse(
    JSON.parse('{"unrelated":1}') as unknown,
  );

  for (const name of PROTOTYPE_MEMBERS) {
    // `as Record<string, Tristate<unknown>>`: the shape is built dynamically, so the mapped return
    // type cannot name these keys.
    const field = (parsed as Record<string, Tristate<unknown>>)[name];
    expect(`${name}=${String(field?.kind)}`).toBe(`${name}=absent`);
  }
});

test('a field named toString or constructor with no wire key resolves to Absent (SERDE-17)', () => {
  const schema = tristateObject({toString: identity, constructor: identity});
  const parsed = schema.parse(JSON.parse('{"a":1}') as unknown);

  expect(parsed.toString.kind).toBe('absent');
  expect(parsed.constructor.kind).toBe('absent');
});

test('a genuinely present key of the same name still decodes to Present', () => {
  const schema = tristateObject({toString: identity, normal: identity});
  const parsed = schema.parse(
    JSON.parse('{"toString":"mine","normal":1}') as unknown,
  );

  expect(parsed.toString.kind).toBe('present');
  expect(valueOrNull(parsed.toString)).toBe('mine');
  expect(valueOrNull(parsed.normal)).toBe(1);
});

// --- a shape field named __proto__ must not rewrite the RESULT's prototype ---------------------

test('a __proto__ field in the shape yields Absent and leaves the result prototype intact', () => {
  // Built with `defineProperty`: `{__proto__: x}` in a literal is the proto-setter syntax, so the
  // key would never become an own property of the shape at all.
  const shape: Record<string, Schema<unknown>> = {};
  Object.defineProperty(shape, '__proto__', {
    value: identity,
    enumerable: true,
    writable: true,
    configurable: true,
  });

  const parsed = tristateObject(shape).parse(
    JSON.parse('{"a":1}') as unknown,
  ) as Record<string, unknown>;

  expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
  const field = Object.getOwnPropertyDescriptor(parsed, '__proto__')?.value as
    Tristate<unknown> | undefined;
  expect(field?.kind).toBe('absent');
  // The sentinel's own members must not have leaked in through the chain.
  expect((parsed as {kind?: unknown}).kind).toBeUndefined();
});

test('a wire-level "__proto__" key is copied as data and pollutes nothing', () => {
  const schema = tristateObject({name: identity});
  const parsed = schema.parse(
    JSON.parse('{"__proto__":{"polluted":true},"name":"x"}') as unknown,
  ) as Record<string, unknown>;

  expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
  expect(Object.getOwnPropertyNames(parsed)).toContain('__proto__');
  expect(({} as {polluted?: unknown}).polluted).toBeUndefined();
});

// --- an array is not an object for this purpose (SERDE-16) -------------------------------------

test('tristateObject rejects an array rather than reshaping it into an index-keyed object', () => {
  const schema = tristateObject({a: identity});

  // An array is `typeof 'object'` and non-null, so a bare object check reshapes `[1,2,3]` into
  // `{"0":1,"1":2,"2":3,"a":Absent}` — a shape mismatch laundered into a plausible-looking DTO.
  expect(() => schema.parse([1, 2, 3])).toThrow(TypeError);
  expect(() => schema.parse([])).toThrow(TypeError);
});

// --- SERDE-29: a shared schema must be unable to acquire state ---------------------------------

test('both combinators return frozen schemas, like the bundle itself', () => {
  expect(Object.isFrozen(tristate(identity))).toBe(true);
  expect(Object.isFrozen(tristateObject({a: identity}))).toBe(true);
});
