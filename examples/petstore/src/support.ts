// SPDX-License-Identifier: MIT
// examples/petstore/src/support.ts
/**
 * The hand-authored runtime binders the generated facade names.
 *
 * A generated SDK ships a small shim beside its facades; this is that shim. The facade holds no
 * logic — it binds arguments and names a symbol from here.
 *
 * What this file measures:
 *
 * - **`jsonBody` is thin, and `petPatchToWire` is not.** Core's `serdeBody(value, serde, mediaType)`
 *   already does encode-plus-wrap, so the body binder is one line. The projection beside it is the
 *   cost: `Schema<T>` is decode-only, so a model whose field names differ from its wire names needs
 *   a hand-written encoder per model. See FINDINGS.md, finding 6.
 * - **`PET_PAGE_STRATEGY` needed no decorator.** Python wraps the certified `CursorStrategy` in a
 *   `_PetPageStrategy` that re-decodes each raw item, because its strategy is configured by wire
 *   FIELD NAMES and hands back raw documents. Node's `cursorStrategy` takes an `extract` callback
 *   instead, so the decode happens inside it and the wrapper class disappears. See finding 5.
 * - **`PET_EVENT_MAPPER` is a plain function.** `SseMapper<T>` is `(eventName, joinedData) =>
 *   MapperOutcome<T>`, and `MAPPER_DONE` is the `[DONE]` sentinel's answer.
 */
import {
  MAPPER_DONE,
  cursorStrategy,
  mapperValue,
  serdeBody,
  type Body,
  type MapperOutcome,
  type PaginationStrategy,
  type Response,
  type Schema,
  type Serde,
  type SseMapper,
} from '@dexpace/core';
import {jsonSerde} from '@dexpace/codec-json';
import {
  PET_EVENT_SCHEMA,
  PET_SCHEMA,
  type Pet,
  type PetEvent,
  type PetPatch,
} from './models.js';

/**
 * The one shared codec instance every binder reuses.
 *
 * `jsonSerde()` freezes its bundle and holds no per-call state (SERDE-29), so a single instance
 * serves every model and every concurrent call. The Tristate wiring is on by default, which is what
 * makes the merge-patch body's three states survive the encode.
 */
const SERDE: Serde = jsonSerde();

const TEXT_ENCODER = new TextEncoder();

/**
 * Encode an already-projected wire document into a request body.
 *
 * @param document - the wire-shaped value, not the model. The projection is the caller's job
 *   because core carries no encode witness — see {@link petPatchToWire}.
 * @param mediaType - overrides the serde's own `application/json`; the petstore's PATCH operation
 *   declares `application/merge-patch+json` in the frozen document, and the generator passes it
 *   through.
 */
export function jsonBody(document: unknown, mediaType?: string): Body {
  return serdeBody(document, SERDE, mediaType);
}

/**
 * Project a {@link PetPatch} onto its wire shape.
 *
 * Only the KEYS change here. The `Tristate` values are passed through untouched and resolved by
 * `jsonSerde()`'s replacer at encode time — Absent drops the key, Null writes `null`, Present
 * writes the value. Resolving them here instead would collapse Absent and Null before the replacer
 * ever saw them, which is precisely the interop bug `Tristate` exists to prevent.
 */
export function petPatchToWire(
  patch: PetPatch,
): Readonly<Record<string, unknown>> {
  return {name: patch.name, tag: patch.tag, weight_kg: patch.weightKg};
}

/** One page of the `/pets` collection, as the frozen document describes it. */
interface PetPage {
  readonly items: readonly Pet[];
  readonly cursor: string | null;
}

const PET_PAGE_SCHEMA: Schema<PetPage> = Object.freeze({
  parse(input: unknown): PetPage {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      throw new TypeError('pet page: expected a JSON object');
    }
    const record = input as Readonly<Record<string, unknown>>;
    const rawItems = record.data;
    if (!Array.isArray(rawItems)) {
      throw new TypeError('pet page: "data" must be an array');
    }
    // `Array.isArray` narrows an `unknown` to `any[]`, and `any` would then flow into
    // `PET_SCHEMA.parse` unchecked. Re-typing to `unknown[]` keeps the decode honest.
    const data = rawItems as readonly unknown[];
    const next = record.next_cursor;
    if (next !== null && next !== undefined && typeof next !== 'string') {
      throw new TypeError('pet page: "next_cursor" must be a string or null');
    }
    return {
      items: data.map(item => PET_SCHEMA.parse(item)),
      cursor: next ?? null,
    };
  },
});

/**
 * Pagination for `listPets`: cursor continuation over a `data` array, splicing `?cursor=` onto the
 * request that produced the page.
 *
 * `extract` reads the body exactly once and never closes the response — both are the strategy
 * contract's obligations, and the paginator closes each page itself.
 */
export const PET_PAGE_STRATEGY: PaginationStrategy<Pet> = cursorStrategy<Pet>({
  parameterName: 'cursor',
  extract: async (response: Response) => {
    const page = SERDE.deserializer.deserialize(await response.bytes(), {
      schema: PET_PAGE_SCHEMA,
      typeName: 'PetPage',
    });
    return {items: page.items, cursor: page.cursor};
  },
});

/** The sentinel `watchPets` ends on, spelled exactly as the frozen document's fixture sends it. */
const DONE_SENTINEL = '[DONE]';

/**
 * SSE mapping for `watchPets`: `[DONE]` ends the stream, every other frame decodes into a
 * {@link PetEvent}.
 *
 * Synchronous by contract — `SseMapper<T>` returns a `MapperOutcome<T>`, not a promise — which is
 * why the decode goes through the deserializer's in-memory entry point rather than its streaming
 * one.
 */
export const PET_EVENT_MAPPER: SseMapper<PetEvent> = (
  eventName: string | undefined,
  joinedData: string,
): MapperOutcome<PetEvent> => {
  if (joinedData === DONE_SENTINEL) return MAPPER_DONE;
  return mapperValue(
    SERDE.deserializer.deserialize(TEXT_ENCODER.encode(joinedData), {
      schema: PET_EVENT_SCHEMA,
      typeName: 'PetEvent',
    }),
  );
};
