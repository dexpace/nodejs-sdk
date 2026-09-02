// SPDX-License-Identifier: MIT
// examples/petstore/src/fake-transport.ts
/**
 * A local in-memory `Transport` for the canary.
 *
 * **This file is finding 5's evidence.** `@dexpace/core` already ships `FakeTransport` and
 * `countingResponse` at `packages/core/src/testing/fake-transport.ts`, and neither is re-exported
 * from the package entry point. Reaching them means deep-importing `packages/core/src/`, while the
 * rest of the example resolves `@dexpace/core` to `packages/core/dist/` — two copies of core in one
 * process, two `HttpStatusError` classes, and every `instanceof` across the boundary silently
 * false. So the example writes its own, exactly as a real consumer would have to.
 *
 * It is not a hardship: the whole thing is a scripted list and one `send`. What it costs is that
 * the fake is unshared, so nothing about it is certified by core's own suite.
 */
import {Headers, Protocol, Request, Response, Status} from '@dexpace/core';
import type {Body, RequestOptions, Transport} from '@dexpace/core';

/** One scripted reply. */
export interface ScriptedReply {
  readonly status: number;
  /** The response body as text; omitted means a body-less response. */
  readonly body?: string | undefined;
  readonly headers?: Readonly<Record<string, string>> | undefined;
}

/** One recorded send. */
export interface RecordedCall {
  readonly request: Request;
  readonly options: RequestOptions | undefined;
  readonly signal: AbortSignal | undefined;
}

const TEXT_ENCODER = new TextEncoder();

function bodyStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(TEXT_ENCODER.encode(text));
      controller.close();
    },
  });
}

/**
 * Drain a request body into bytes.
 *
 * `Body` exposes `writeTo(sink)` and no byte accessor, so reading what a facade actually sent means
 * supplying a sink. Used by the merge-patch assertion, which has to see the encoded document.
 */
export async function readBodyBytes(body: Body): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  await body.writeTo(
    new WritableStream<Uint8Array>({
      write(chunk: Uint8Array): void {
        chunks.push(chunk);
      },
    }),
  );
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * A scripted transport. Entries are served in order; once exhausted the last entry repeats, and a
 * FRESH response — with a fresh body stream — is built per call, so a repeated entry is safe to
 * consume more than once.
 */
export class LocalFakeTransport implements Transport {
  readonly #script: readonly ScriptedReply[];
  readonly #calls: RecordedCall[] = [];
  #closeCount = 0;

  constructor(script: readonly ScriptedReply[]) {
    if (script.length === 0) {
      throw new TypeError(
        'LocalFakeTransport needs at least one scripted reply',
      );
    }
    this.#script = [...script];
  }

  /** Every send this double served, in order. */
  get calls(): readonly RecordedCall[] {
    return this.#calls;
  }

  /** How many times `close()` was called — the owned/borrowed assertion reads this. */
  get closeCount(): number {
    return this.#closeCount;
  }

  send(
    request: Request,
    options?: RequestOptions,
    signal?: AbortSignal,
  ): Promise<Response> {
    const reply =
      this.#script[Math.min(this.#calls.length, this.#script.length - 1)];
    this.#calls.push({request, options, signal});
    if (reply === undefined) {
      return Promise.reject(new Error('scripted reply index out of range'));
    }
    const headers = Headers.newBuilder();
    for (const [name, value] of Object.entries(reply.headers ?? {})) {
      headers.setInbound(name, value);
    }
    return Promise.resolve(
      Response.newBuilder()
        .request(request)
        .protocol(Protocol.HTTP_1_1)
        .status(Status.of(reply.status))
        .headers(headers.build())
        .body(reply.body === undefined ? null : bodyStream(reply.body))
        .build(),
    );
  }

  close(): Promise<void> {
    this.#closeCount += 1;
    return Promise.resolve();
  }
}
