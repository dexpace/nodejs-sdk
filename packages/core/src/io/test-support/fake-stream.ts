// SPDX-License-Identifier: MIT
// packages/core/src/io/test-support/fake-stream.ts
// Test-only. Excluded from the build (tsconfig.build.json) and never exported from any barrel.
// Styleguide 11.3: fake your own interfaces rather than reaching for mock.module.

/** A readable stream that yields exactly the chunks given, at exactly those boundaries. */
export function fakeReadableStream(
  chunks: readonly Uint8Array[],
  onCancel?: () => void,
): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    cancel(): void {
      onCancel?.();
    },
    pull(controller): void {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      const chunk = chunks[index];
      index += 1;
      if (chunk !== undefined) controller.enqueue(chunk);
    },
  });
}

/** A readable stream that violates the read protocol by yielding an empty chunk (drives IO-17). */
export function protocolViolatingStream(): ReadableStream<Uint8Array> {
  return fakeReadableStream([new Uint8Array(0)]);
}

/** A writable stream that accumulates everything written, for asserting the wire payload. */
export function collectingWritableStream(): {
  stream: WritableStream<Uint8Array>;
  written: () => Uint8Array;
  chunkSizes: () => number[];
  isClosed: () => boolean;
  abortReason: () => unknown;
  wasAborted: () => boolean;
} {
  const parts: Uint8Array[] = [];
  let closed = false;
  let aborted = false;
  let abortReason: unknown = undefined;
  const stream = new WritableStream<Uint8Array>({
    write(chunk): void {
      parts.push(chunk.slice());
    },
    close(): void {
      closed = true;
    },
    abort(reason: unknown): void {
      aborted = true;
      abortReason = reason;
    },
  });
  const written = (): Uint8Array => {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  };
  return {
    stream,
    written,
    chunkSizes: () => parts.map(part => part.length),
    isClosed: () => closed,
    abortReason: () => abortReason,
    wasAborted: () => aborted,
  };
}

/** A writable stream whose writes stay pending until released, for observing emit/flush ordering. */
export function gatedWritableStream(): {
  stream: WritableStream<Uint8Array>;
  delivered: () => number;
  release: () => void;
} {
  let delivered = 0;
  let open: (() => void) | undefined;
  const gate = new Promise<void>(resolve => {
    open = resolve;
  });
  const stream = new WritableStream<Uint8Array>({
    async write(chunk): Promise<void> {
      await gate;
      delivered += chunk.length;
    },
  });
  return {
    stream,
    delivered: () => delivered,
    release: () => open?.(),
  };
}

/** A writable stream whose `close` rejects, for asserting teardown-failure behavior. */
export function failingCloseWritableStream(
  message: string,
): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    close(): never {
      throw new Error(message);
    },
  });
}

/** A writable stream whose first write rejects, for asserting failure-path behavior. */
export function failingWritableStream(
  message: string,
): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    write(): never {
      throw new Error(message);
    },
  });
}

/**
 * Read a stream to completion and return everything it yielded.
 *
 * Hand-rolled rather than `new Response(stream).arrayBuffer()`: `Response` is a restricted global here,
 * since in this package the name belongs to the SDK's own HTTP model.
 */
export async function drainStream(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    parts.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
