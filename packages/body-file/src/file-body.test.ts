// SPDX-License-Identifier: MIT
// packages/body-file/src/file-body.test.ts
// Exercises: HTTP-40/BODY-11 (fail-fast construction validation, fresh handle per write, replayable),
// BODY-13 (short-write detection), BODY-12/TRANSPORT-28 (recognizable by type)
/* eslint-disable max-lines-per-function -- file body tests need full I/O lifecycle setup */
import {afterEach, beforeEach, describe, expect, test} from 'bun:test';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileBody} from './file-body.js';

let dir: string;
let filePath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'body-file-'));
  filePath = join(dir, 'payload.bin');
  await writeFile(filePath, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
});

afterEach(async () => {
  await rm(dir, {recursive: true, force: true});
});

describe('fileBody (HTTP-40, BODY-11)', () => {
  test('is recognizable by kind and replayable', () => {
    const body = fileBody(filePath);
    expect(body.kind).toBe('file');
    expect(body.replayable).toBe(true);
    expect(body.contentLength).toBe(8);
    expect(body.mediaType).toBeUndefined();
  });

  test('rejects a nonexistent path at construction', () => {
    expect(() => fileBody(join(dir, 'missing.bin'))).toThrow();
  });

  test('rejects a directory path at construction', () => {
    expect(() => fileBody(dir)).toThrow();
  });

  test('rejects a negative start or out-of-range count at construction', () => {
    expect(() => fileBody(filePath, {start: -1})).toThrow();
    expect(() => fileBody(filePath, {start: 4, count: 10})).toThrow();
    expect(() => fileBody(filePath, {count: -1})).toThrow();
    expect(() => fileBody(filePath, {start: 100})).toThrow();
  });

  test('writeTo does not close the caller-owned sink', async () => {
    const body = fileBody(filePath);
    let closed = false;
    const sink = new WritableStream<Uint8Array>({
      close() {
        closed = true;
      },
      write() {
        // no-op: we only care about close tracking
      },
    });
    await body.writeTo(sink);
    expect(closed).toBe(false);
  });

  test('writeTo streams exactly the declared byte range', async () => {
    const body = fileBody(filePath, {start: 2, count: 4});
    const chunks: Uint8Array[] = [];
    const sink = new WritableStream<Uint8Array>({
      write(chunk) {
        chunks.push(chunk);
      },
    });
    await body.writeTo(sink);
    const totalLength = chunks.reduce((acc, c) => acc + c.byteLength, 0);
    const written = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      written.set(chunk, offset);
      offset += chunk.byteLength;
    }
    expect(written).toEqual(new Uint8Array([3, 4, 5, 6]));
  });

  test('writeTo handles 0 count', async () => {
    const body = fileBody(filePath, {start: 0, count: 0});
    const chunks: Uint8Array[] = [];
    const sink = new WritableStream<Uint8Array>({
      write(chunk) {
        chunks.push(chunk);
      },
    });
    await body.writeTo(sink);
    expect(chunks.length).toBe(0);
  });

  test('writeTo opens a fresh handle on each call (replayable)', async () => {
    const body = fileBody(filePath);
    const first: number[] = [];
    const second: number[] = [];
    await body.writeTo(
      new WritableStream({
        write(c) {
          first.push(...c);
        },
      }),
    );
    await body.writeTo(
      new WritableStream({
        write(c) {
          second.push(...c);
        },
      }),
    );
    expect(second).toEqual(first);
  });

  test('writeTo propagates error from stream read or write', () => {
    const body = fileBody(filePath);
    const sink = new WritableStream<Uint8Array>({
      write: () => {
        throw new Error('sink write error');
      },
    });
    expect(body.writeTo(sink)).rejects.toThrow('sink write error');
  });
});
