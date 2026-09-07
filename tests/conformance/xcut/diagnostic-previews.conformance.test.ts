// SPDX-License-Identifier: MIT
// tests/conformance/xcut/diagnostic-previews.conformance.test.ts
// Exercises: XCUT-24 (a diagnostic preview of a caller- or server-controlled payload is byte-capped
// and non-consuming -- it must not materialize an unbounded payload, and must not disturb the
// primary read path the consumer will use).
//
// Diagnostic previews are not a standalone Response method in this port: they surface through 7b's
// LOGGING step at `granularity: 'body'`, which tees the body bounded to `previewSizeBytes` into the
// emitted `http.response` event (OBS-36). 7b's own logging-step.test.ts asserts that against a fake
// transport and a 50 KB in-memory string; this file runs XCUT-24's own conformance clause verbatim --
// "a 10 MB response with a small cap" -- over a real socket through the whole composed pipeline,
// which is where a tee that buffered the entire body would actually show up.
import {afterAll, beforeAll, describe, expect, test} from 'bun:test';
import {Request, createLogger, type LogLevel} from '@dexpace/core';
import {buildComposedPipeline} from './fixtures/composed-pipeline.js';
import {startFixtureServer, type XcutFixtureServer} from './fixtures/server.js';

let server: XcutFixtureServer;

/** XCUT-24's own figure: "take a body snapshot/preview of a 10 MB response with a small cap". */
const BODY_BYTES = 10 * 1024 * 1024;
const PREVIEW_CAP = 1024;

beforeAll(async () => {
  server = await startFixtureServer();
});

afterAll(async () => {
  await server.close();
});

/** Collects every emitted event as a plain field map, the same shape 7b's own spy logger uses. */
function spyLogger(): {
  logger: ReturnType<typeof createLogger>;
  events: Record<string, unknown>[];
} {
  const events: Record<string, unknown>[] = [];
  const logger = createLogger((_level: LogLevel, fields) => {
    events.push(Object.fromEntries(fields));
  });
  return {logger, events};
}

/** Drives a 10 MB response through the composed pipeline with body logging capped low. */
async function captureLargeBody(
  mediaType = 'application/octet-stream',
): Promise<{
  events: Record<string, unknown>[];
  bodyLength: number;
}> {
  const {logger, events} = spyLogger();
  const pipeline = buildComposedPipeline({
    retry: {settings: {maxAttempts: 1}},
    logging: {logger, granularity: 'body', previewSizeBytes: PREVIEW_CAP},
  });
  try {
    const response = await pipeline.runtime.send(
      Request.newBuilder()
        .url(
          `${server.url}/large-body?bytes=${String(BODY_BYTES)}&type=${encodeURIComponent(mediaType)}`,
        )
        .build(),
    );
    const body = await response.bytes();
    await response.close();
    return {events, bodyLength: body.byteLength};
  } finally {
    await pipeline.close();
  }
}

describe('XCUT-24: a diagnostic preview is byte-capped', () => {
  test('caps a decoded text preview at previewSizeBytes across a 10 MB body', async () => {
    const {events} = await captureLargeBody('text/plain');

    const responseEvent = events.find(event => event.event === 'http.response');
    expect(String(responseEvent?.['http.response.body.preview'])).toHaveLength(
      PREVIEW_CAP,
    );
  });

  test('caps a binary body at the same figure, reported as a size-only marker', async () => {
    const {events} = await captureLargeBody('application/octet-stream');

    const responseEvent = events.find(event => event.event === 'http.response');
    // OBS-38: a binary payload is never decoded into the log. The marker still has to report a
    // capped capture, which is the half XCUT-24 cares about.
    expect(responseEvent?.['http.response.body.preview']).toBe(
      `[binary ${String(PREVIEW_CAP)} bytes captured]`,
    );
  });

  test('reports the captured size as the cap, not the payload size', async () => {
    const {events} = await captureLargeBody();

    const responseEvent = events.find(event => event.event === 'http.response');
    // Had the tee buffered the whole body to slice a preview off the end, this would read 10485760 --
    // which is the memory-exhaustion shape XCUT-24 exists to forbid, not merely a wrong number.
    expect(responseEvent?.['http.response.body.size']).toBe(PREVIEW_CAP);
  });

  test('emits no field carrying more than the cap', async () => {
    const {events} = await captureLargeBody();

    const responseEvent = events.find(event => event.event === 'http.response');
    const oversized = Object.entries(responseEvent ?? {}).filter(
      ([, value]) => typeof value === 'string' && value.length > PREVIEW_CAP,
    );
    // Guards the whole event, not just the field key this port happens to use today.
    expect(oversized).toEqual([]);
  });
});

describe('XCUT-24: a diagnostic preview is non-consuming', () => {
  test('leaves the caller reading every one of the 10485760 bytes', async () => {
    const {bodyLength} = await captureLargeBody();

    // The primary read path must be undisturbed: the consumer sees the full body, not the truncation
    // the log saw.
    expect(bodyLength).toBe(BODY_BYTES);
  });
});
