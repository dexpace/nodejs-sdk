// SPDX-License-Identifier: MIT
// examples/petstore/generate.d.mts
/**
 * Types for `generate.mjs`, hand-written because the generator is a plain ESM script.
 *
 * The alternative — `allowJs` in `tsconfig.json` — types `renderAll()` as
 * `Promise<Map<string, any>>`, and `any` then flows into the regen test where
 * `strictTypeChecked`'s `no-unsafe-*` rules reject it. Declaring the surface is both smaller and
 * honest about what the script exports.
 */

/** Parse the frozen OpenAPI document. */
export declare function loadSpec(specPath?: string): unknown;

/** Every operation in the document, sorted by `operationId`. */
export declare function collectOperations(spec: unknown): unknown[];

/** Render the operation-table module's text. */
export declare function renderOperations(ops: unknown[]): string;

/** Render the facade module's text. */
export declare function renderClient(ops: unknown[], className: string): string;

/** Every generated file as `name -> Prettier-formatted content`; writes nothing. */
export declare function renderAll(
  specPath?: string,
): Promise<Map<string, string>>;

/** Render and write every generated file; returns how many were written. */
export declare function writeAll(
  specPath?: string,
  outDir?: string,
): Promise<number>;
