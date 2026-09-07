// SPDX-License-Identifier: MIT
// packages/core/src/body/freeze-body.ts
import type {Body} from './body.js';

/**
 * Freezes a fully-constructed {@link Body}, as the last statement of its constructor.
 *
 * `readonly` is erased at run time, so without this a caller can reassign a body's own metadata after
 * construction and desynchronize it from the bytes `writeTo` emits:
 *
 * ```ts
 * const body = byteArrayBody(Uint8Array.from([1, 2, 3]));
 * (body as {contentLength: number}).contentLength = 999; // declared 999, writes 3
 * ```
 *
 * That is the same declared-length-versus-written-bytes drift `HTTP-51` makes `MultipartBody` share one
 * framing routine to prevent, and that `HTTP-1`/`XCUT-15` make it defensively copy its parts array for --
 * left open one level up, on the field the transport actually stamps into `Content-Length`.
 *
 * A named helper rather than five inlined `Object.freeze(this)` calls so the reason lives in one place;
 * the freeze is shallow and is never relied on to cascade, matching the domain-model convention
 * `packages/core/src/http/` already follows. `#private` fields are unaffected, which is why
 * `StreamBody`'s consumed-once flag still works on a frozen instance.
 */
export function freezeBody(body: Body): void {
  Object.freeze(body);
}
