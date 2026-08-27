// SPDX-License-Identifier: MIT
// packages/codec-json/src/index.ts

/**
 * `@dexpace/codec-json` — the reference wire codec.
 *
 * Wraps `JSON.parse`/`JSON.stringify` behind `@dexpace/core`'s `Serde` seam. Depends on nothing
 * beyond a `@dexpace/core` peer: schema validation is the caller's, supplied as a `Schema<T>` value
 * at each decode call.
 *
 * @packageDocumentation
 */
export {jsonSerde} from './json-serde.js';
export type {JsonSerdeOptions} from './json-serde.js';
export {tristateReplacer} from './tristate-replacer.js';
export {tristate, tristateObject} from './tristate-schema.js';
