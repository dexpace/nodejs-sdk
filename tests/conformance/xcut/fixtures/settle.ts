// SPDX-License-Identifier: MIT
// tests/conformance/xcut/fixtures/settle.ts

/**
 * Awaits `promise` and hands back the reason it rejected with, or `undefined` if it resolved.
 *
 * Used instead of `await expect(p).rejects.toBeInstanceOf(...)` throughout this suite. Bun types the
 * `.rejects` matchers as returning `void`, so awaiting one trips `await-thenable` and
 * `no-confusing-void-expression` under this repo's type-aware lint tier, and the idiom the packages
 * settled on -- dropping the `await` -- makes the assertion fire-and-forget: the matcher's own
 * failure surfaces after the test has already returned, if at all.
 *
 * Capturing the rejection and asserting on the value synchronously is both lint-clean and genuinely
 * awaited, which matters here because every row in this directory is asserting on WHICH error came
 * back, not merely that one did.
 *
 * @param promise - the operation under test.
 * @returns the rejection reason, or `undefined` when the promise resolved.
 */
export async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
}
