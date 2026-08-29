// SPDX-License-Identifier: MIT
// packages/shrink-test/shrink-test.config.ts

/** The knobs {@link SHRINK_TEST_CONFIG} fixes for the `NFR-9` guard. */
export interface ShrinkTestConfig {
  /**
   * The hard ceiling `run-shrink-guard.ts` fails the build on, in bytes of minified, tree-shaken
   * output. Not a footprint target: the number exists to catch a *regression in shape* -- a barrel
   * that stops tree-shaking, a side-effectful module pulled in wholesale -- not to police normal
   * growth. Raise it only with the measured before/after in the commit message.
   */
  readonly budgetBytes: number;
  /**
   * The packages `fixture-app.ts` imports, and therefore the ones this guard proves survive a
   * bundle-and-tree-shake round trip. Recorded here so the set is reviewable in one place rather
   * than inferred from the fixture's import list.
   */
  readonly participatingPackages: readonly string[];
}

/**
 * Measured at 16,671 bytes on 2026-08-29 (esbuild 0.28.2; `@dexpace/core` + `@dexpace/transport-fetch`
 * + `@dexpace/codec-json`, all three reached through their published entry points). The budget is
 * 24 KiB -- ~47% headroom, which absorbs ordinary growth while still catching the failure this guard
 * exists for: a tree-shaking regression pulls in core's barrel wholesale and shows up as a multiple
 * of this figure, not a few percent over it. A loose budget would catch nothing.
 */
export const SHRINK_TEST_CONFIG: ShrinkTestConfig = Object.freeze({
  budgetBytes: 24_576,
  participatingPackages: Object.freeze([
    '@dexpace/core',
    '@dexpace/transport-fetch',
    '@dexpace/codec-json',
  ]),
});
