// SPDX-License-Identifier: MIT
// packages/core/src/body/write-body.ts

/**
 * Runs `write` against a fresh writer over `sink`, closing on success and aborting on failure.
 *
 * The naive shape -- `try { ... } finally { await writer.close(); }` -- is wrong twice over. Closing an
 * already-errored writer rejects with a TypeError, and a throwing `finally` *replaces* the in-flight
 * exception, so the real "connection died mid-upload" cause is destroyed rather than chained (RECOV-12).
 * That is not merely a bad message: RETRY-2 classifies a failure by walking its cause chain, so an I/O
 * failure surfacing as a TypeError about closing a stream is silently declassified as non-retryable.
 *
 * Aborting rather than closing on failure also tells the transport the message is broken; a clean close
 * would signal a complete body that was never fully written.
 */
export async function withBodyWriter(
  sink: WritableStream<Uint8Array>,
  write: (writer: WritableStreamDefaultWriter<Uint8Array>) => Promise<void>,
): Promise<void> {
  const writer = sink.getWriter();
  try {
    await write(writer);
  } catch (error: unknown) {
    // Best-effort: abort() resolves on an already-errored stream, and a sink whose own abort() throws
    // must not displace the primary failure either.
    await writer.abort(error).catch(() => undefined);
    throw error;
  }
  // On the success path a close failure IS the primary failure, so it propagates unwrapped.
  await writer.close();
}
