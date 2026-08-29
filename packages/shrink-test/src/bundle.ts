// SPDX-License-Identifier: MIT
// packages/shrink-test/src/bundle.ts
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

/** The in-memory result of one bundle-and-minify pass; nothing is written to disk here. */
export interface ShrinkBundle {
  /** The bundled, minified, tree-shaken ESM source. */
  readonly code: string;
  /** Its size in bytes, as the budget in `shrink-test.config.ts` measures it. */
  readonly bytes: number;
}

/**
 * Bundles `fixture-app.ts` and everything it imports into one minified, tree-shaken ESM module, the
 * way a downstream consumer's bundler would.
 *
 * `write: false` keeps the pass in memory -- `run-shrink-guard.ts` is the only caller that needs the
 * bytes on disk, and it writes them to a temp dir it owns. `platform: 'node'` matches the runtime the
 * guard then executes the output on, so `node:` builtins stay external instead of being inlined or
 * shimmed.
 *
 * @returns the bundled code and its byte length.
 * @throws Error - when esbuild reports success but produces no output file, which would otherwise
 *   surface later as an unreadable `undefined` and be mistaken for a size regression.
 */
export async function buildShrinkBundle(): Promise<ShrinkBundle> {
  const entryPoint = fileURLToPath(
    new URL('./fixture-app.ts', import.meta.url),
  );
  const result = await build({
    entryPoints: [entryPoint],
    bundle: true,
    minify: true,
    treeShaking: true,
    platform: 'node',
    format: 'esm',
    write: false,
  });

  const output = result.outputFiles[0];
  if (output === undefined) {
    throw new Error('esbuild reported success but produced no output file');
  }
  return {code: output.text, bytes: output.contents.byteLength};
}
