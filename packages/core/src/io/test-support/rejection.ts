// SPDX-License-Identifier: MIT
// packages/core/src/io/test-support/rejection.ts
// Test-only. Excluded from the build (tsconfig.build.json) and never exported from any barrel.

/**
 * Await a promise that must reject, and return the rejection reason.
 *
 * Why this exists rather than `expect(promise).rejects.toThrow(...)`: bun types `rejects` as
 * `Matchers<unknown>`, whose `toThrow()` returns `void` even though at run time it returns a promise.
 * So `await`ing it fails `@typescript-eslint/await-thenable`, and omitting the `await` leaves the
 * assertion racing test teardown — bun still fails the run, but the failure can attribute to a later
 * test. Capturing the rejection keeps every failure awaited and attributable, with no lint suppression.
 */
export async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (e: unknown) {
    if (e instanceof Error) return e;
    throw new Error(`expected an Error rejection, got ${typeof e}`);
  }
  throw new Error('expected the promise to reject, but it resolved');
}
