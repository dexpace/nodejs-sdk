// SPDX-License-Identifier: MIT
// examples/petstore/src/models.ts
/**
 * Hand-written models for the petstore canary, plus a `Schema<T>` witness for each.
 *
 * Models are deliberately NOT generated — the generator reads `operationId`, the method, the path
 * template and the `x-dexpace` extension, and nothing else (the issue's non-goals say so). What is
 * written here is what a real generated SDK ships beside its facades.
 *
 * Two things are worth noticing while reading, because both are findings rather than style:
 *
 * 1. **Every model needs a decode witness AND a hand-written encode projection.** `Schema<T>` is a
 *    one-way seam: `parse(input: unknown): T`. There is no encode witness anywhere in core, so a
 *    model whose field names differ from its wire names — `petId` vs `pet_id`, `weightKg` vs
 *    `weight_kg` — has to carry a `toWire` function written by hand. See `support.ts`.
 *
 * 2. **`PetPatch`'s fields are `Tristate`, and that is the whole point of the merge-patch case.**
 *    Absent means "leave unchanged", Null means "clear", Present means "set". `@dexpace/codec-json`
 *    carries both halves: `tristateReplacer` on the encode side (installed by `jsonSerde()` by
 *    default) and `tristateObject` on the decode side.
 */
import {absent, type Schema, type Tristate} from '@dexpace/core';
import {tristateObject} from '@dexpace/codec-json';

/** A pet as the service returns it. */
export interface Pet {
  readonly id: string;
  readonly name: string;
  /** `null` when the pet carries no tag; the wire field is nullable, not omissible. */
  readonly tag: string | null;
}

/** One pet lifecycle event, delivered over SSE. Wire field `pet_id` becomes `petId` here. */
export interface PetEvent {
  readonly kind: string;
  readonly petId: string;
}

/**
 * A merge-patch update body.
 *
 * Every field defaults to Absent through {@link emptyPetPatch}, so
 * `{...emptyPetPatch(), name: present('Rex')}` sends only `name` and leaves the rest untouched.
 */
export interface PetPatch {
  readonly name: Tristate<string>;
  readonly tag: Tristate<string>;
  readonly weightKg: Tristate<number>;
}

/** A patch with every field Absent — the identity element a caller spreads over. */
export function emptyPetPatch(): PetPatch {
  return {name: absent(), tag: absent(), weightKg: absent()};
}

/**
 * Narrow an already-parsed wire value to a JSON object.
 *
 * An array is `typeof 'object'` and non-null, so the array check is not decoration: without it a
 * `[1, 2, 3]` arriving where a DTO was expected is silently reshaped into `{'0': 1, ...}` rather
 * than rejected.
 */
function asObject(
  input: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError(`${label}: expected a JSON object`);
  }
  return input as Readonly<Record<string, unknown>>;
}

function requireString(
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new TypeError(`${label}: "${key}" must be a string`);
  }
  return value;
}

function nullableString(
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): string | null {
  const value = record[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new TypeError(`${label}: "${key}" must be a string or null`);
  }
  return value;
}

/** Decode witness for {@link Pet}. */
export const PET_SCHEMA: Schema<Pet> = Object.freeze({
  parse(input: unknown): Pet {
    const record = asObject(input, 'Pet');
    return {
      id: requireString(record, 'id', 'Pet'),
      name: requireString(record, 'name', 'Pet'),
      tag: nullableString(record, 'tag', 'Pet'),
    };
  },
});

/** Decode witness for {@link PetEvent}; renames the wire's `pet_id`. */
export const PET_EVENT_SCHEMA: Schema<PetEvent> = Object.freeze({
  parse(input: unknown): PetEvent {
    const record = asObject(input, 'PetEvent');
    return {
      kind: requireString(record, 'kind', 'PetEvent'),
      petId: requireString(record, 'pet_id', 'PetEvent'),
    };
  },
});

const STRING_SCHEMA: Schema<string> = Object.freeze({
  parse(input: unknown): string {
    if (typeof input !== 'string') throw new TypeError('expected a string');
    return input;
  },
});

const NUMBER_SCHEMA: Schema<number> = Object.freeze({
  parse(input: unknown): number {
    if (typeof input !== 'number') throw new TypeError('expected a number');
    return input;
  },
});

/**
 * The wire-shaped half of {@link PetPatch}: `tristateObject` keys by WIRE name, so the rename to
 * `weightKg` happens in {@link PET_PATCH_SCHEMA}'s own `parse` and not in the combinator.
 */
const PET_PATCH_WIRE_SCHEMA = tristateObject({
  name: STRING_SCHEMA,
  tag: STRING_SCHEMA,
  weight_kg: NUMBER_SCHEMA,
});

/**
 * Decode witness for {@link PetPatch}.
 *
 * Only the canary uses it — a service does not normally decode its own request bodies. It is here
 * so the merge-patch round trip is asserted on a `PetPatch`, not on a raw JSON document: an
 * assertion over the document alone proves the encoder emitted the right bytes but nothing about
 * the three states surviving a full round trip.
 */
export const PET_PATCH_SCHEMA: Schema<PetPatch> = Object.freeze({
  parse(input: unknown): PetPatch {
    const wire = PET_PATCH_WIRE_SCHEMA.parse(asObject(input, 'PetPatch'));
    return {name: wire.name, tag: wire.tag, weightKg: wire.weight_kg};
  },
});
