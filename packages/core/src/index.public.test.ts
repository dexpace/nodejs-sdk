// SPDX-License-Identifier: MIT
// packages/core/src/index.public.test.ts
// Exercises: SEAM-21's closure — the reshaped serde seam is reachable from the package's public entry
// point, which is what a separate `@dexpace/codec-json` package needs and what promotes it (SERDE-1/5).
import {expect, test} from 'bun:test';

test('the serde seam is publicly importable, because a separate codec package must reach it', async () => {
  const barrel = await import('./index.js');
  for (const name of [
    'absent',
    'nullValue',
    'present',
    'ofNullable',
    'foldTristate',
    'valueOrNull',
    'isAbsent',
    'isNull',
    'isPresent',
    'isTristate',
    'tristateToString',
    'TRISTATE_BRAND',
    'SerializationError',
    'DeserializationError',
    'isSerdeError',
    'serdeBody',
    'decodeResponse',
    'decodeSuccessResponse',
  ]) {
    expect(barrel).toHaveProperty(name);
  }
});

test('io/ is still not public — 3b froze that decision and 6a does not reopen it', async () => {
  const barrel = await import('./index.js');
  for (const name of [
    'ByteQueue',
    'BufferedSource',
    'BufferedSink',
    'TeeSink',
  ]) {
    expect(barrel).not.toHaveProperty(name);
  }
});

test('the SSE surface is publicly importable', async () => {
  const barrel = await import('./index.js');
  for (const name of [
    'sseStreamFrom',
    'SseStream',
    'typedSseStream',
    'mapperValue',
    'MAPPER_SKIP',
    'MAPPER_DONE',
    'SseStreamError',
    'SseLineTooLongError',
    'makeSseEvent',
    'sseEventsEqual',
    'isSseEventEmpty',
    'sseEventToString',
  ]) {
    expect(barrel).toHaveProperty(name);
  }
});

test('the pagination surface is publicly importable', async () => {
  const barrel = await import('./index.js');
  for (const name of [
    'Paginator',
    'Page',
    'pageInfo',
    'cursorStrategy',
    'pageNumberStrategy',
    'linkHeaderStrategy',
    'paginateWithFetchers',
    'PaginationError',
  ]) {
    expect(barrel).toHaveProperty(name);
  }
});

test('the SSE parser internals stay private — publishing them would publish a way to break SSE-17', async () => {
  const barrel = await import('./index.js');
  for (const name of ['SseParser', 'SseLineReader']) {
    expect(barrel).not.toHaveProperty(name);
  }
});

test('the URL-manipulation internals stay private — one public query surface, not two', async () => {
  const barrel = await import('./index.js');
  for (const name of [
    'spliceQueryParam',
    'readQueryParam',
    'parseLinkHeader',
    'findNextLink',
  ]) {
    expect(barrel).not.toHaveProperty(name);
  }
});

test('nothing under src/pagination/ imports serde (§12: the engine is serde-agnostic)', async () => {
  const {readdirSync, readFileSync} = await import('node:fs');
  const paginationDir = new URL('./pagination/', import.meta.url);
  const names = readdirSync(paginationDir).filter(
    f => f.endsWith('.ts') && !f.endsWith('.test.ts'),
  );
  const sourceOf = (name: string): string =>
    readFileSync(new URL(name, paginationDir), 'utf8');
  for (const name of names) {
    const code = sourceOf(name).replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
    expect(code).not.toMatch(/from\s+['"].*(serde|codec-json)/);
  }
});

test('nothing under src/pagination/ uses URLSearchParams (PAGE-21)', async () => {
  const {readdirSync, readFileSync} = await import('node:fs');
  const paginationDir = new URL('./pagination/', import.meta.url);
  const names = readdirSync(paginationDir).filter(
    f => f.endsWith('.ts') && !f.endsWith('.test.ts'),
  );
  const sourceOf = (name: string): string =>
    readFileSync(new URL(name, paginationDir), 'utf8');
  for (const name of names) {
    const code = sourceOf(name).replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
    expect(code).not.toContain('URLSearchParams');
  }
});
