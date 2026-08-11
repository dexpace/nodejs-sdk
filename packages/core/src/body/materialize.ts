// SPDX-License-Identifier: MIT
// packages/core/src/body/materialize.ts
import {invariant} from '../invariant.js';
import type {Body} from './body.js';
import {byteArrayBody} from './simple-bodies.js';

/**
 * Returns `body` unchanged if already replayable; otherwise drains its single write into a fresh
 * replayable ByteArrayBody, after which the original is treated as consumed (BODY-3/HTTP-37).
 *
 * @public
 */
export async function materialize(body: Body): Promise<Body> {
  if (body.replayable) return body;
  const chunks: Uint8Array[] = [];
  let total = 0;
  const collector = new WritableStream<Uint8Array>({
    write: chunk => {
      chunks.push(chunk);
      total += chunk.length;
    },
  });
  await body.writeTo(collector);

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  invariant(
    offset === total,
    `materialized ${String(offset)} bytes, expected ${String(total)}`,
  );

  const replayed = byteArrayBody(bytes, body.mediaType);
  invariant(replayed.replayable, 'materialize must return a replayable body'); // BODY-3's postcondition
  return replayed;
}
