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
  isClosed: () => boolean;
} {
  const parts: Uint8Array[] = [];
  let closed = false;
  const stream = new WritableStream<Uint8Array>({
    write(chunk): void {
      parts.push(chunk.slice());
    },
    close(): void {
      closed = true;
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
  return {stream, written, isClosed: () => closed};
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
