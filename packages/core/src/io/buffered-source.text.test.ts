// SPDX-License-Identifier: MIT
// packages/core/src/io/buffered-source.text.test.ts
// Exercises: IO-13 (UTF-8 and explicit-charset decode), IO-14 (line reads: \n and \r\n terminators,
// lone \r stays content, final unterminated line returned as-is, undefined when exhausted first)
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {BufferedSource} from './buffered-source.js';
import {fakeReadableStream} from './test-support/fake-stream.js';
import {rejection} from './test-support/rejection.js';

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

const sourceOver = (...chunks: Uint8Array[]): BufferedSource =>
  BufferedSource.overStream(fakeReadableStream(chunks));

/** Split `bytes` at the given cut points, so a terminator can straddle a chunk boundary. */
function chunkAt(bytes: Uint8Array, cuts: readonly number[]): Uint8Array[] {
  const bounded = [
    ...new Set(cuts.filter(c => c > 0 && c < bytes.length)),
  ].sort((a, b) => a - b);
  const out: Uint8Array[] = [];
  let previous = 0;
  for (const cut of bounded) {
    out.push(bytes.subarray(previous, cut));
    previous = cut;
  }
  // An empty trailing subarray (only possible when `bytes` itself is empty) would enqueue a zero-length
  // chunk, which RetentionWindow correctly rejects as an IO-17 protocol violation — a stream signals
  // end-of-stream via `done`, never via a 0-byte delivery. Omitting it here keeps the fixture itself
  // protocol-clean.
  const last = bytes.subarray(previous);
  if (last.length > 0) out.push(last);
  return out;
}

describe('BufferedSource text reads (IO-13)', () => {
  test('readUtf8 decodes non-ASCII text', async () => {
    expect(await sourceOver(utf8('héllo ☃')).readUtf8()).toBe('héllo ☃');
  });

  test('readUtf8 decodes across a chunk boundary that splits a multi-byte character', async () => {
    const encoded = utf8('☃');
    const source = sourceOver(encoded.subarray(0, 1), encoded.subarray(1));
    expect(await source.readUtf8()).toBe('☃');
  });

  test('readString decodes an explicit non-UTF-8 charset', async () => {
    // 0xE9 is é in ISO-8859-1 and invalid alone in UTF-8 — so this only passes if the charset is honored.
    const source = sourceOver(Uint8Array.from([0x68, 0xe9]));
    expect(await source.readString('iso-8859-1')).toBe('hé');
  });

  test('readString rejects an unknown charset label', async () => {
    expect(
      (await rejection(sourceOver(utf8('x')).readString('not-a-charset')))
        .message,
    ).toContain('unsupported charset: not-a-charset');
  });
});

describe('BufferedSource line reads (IO-14)', () => {
  test('splits on \\n and consumes the terminator', async () => {
    const source = sourceOver(utf8('one\ntwo\n'));
    expect(await source.readUtf8Line()).toBe('one');
    expect(await source.readUtf8Line()).toBe('two');
    expect(await source.readUtf8Line()).toBeUndefined();
  });

  test('treats \\r\\n as a terminator and strips both bytes', async () => {
    const source = sourceOver(utf8('one\r\ntwo\r\n'));
    expect(await source.readUtf8Line()).toBe('one');
    expect(await source.readUtf8Line()).toBe('two');
  });

  test('keeps a lone \\r not followed by \\n as line content', async () => {
    const source = sourceOver(utf8('a\rb\n'));
    expect(await source.readUtf8Line()).toBe('a\rb');
  });

  test('returns a final unterminated line as-is', async () => {
    const source = sourceOver(utf8('one\ntwo'));
    expect(await source.readUtf8Line()).toBe('one');
    expect(await source.readUtf8Line()).toBe('two');
    expect(await source.readUtf8Line()).toBeUndefined();
  });

  test('returns undefined when exhausted before any byte', async () => {
    expect(await sourceOver().readUtf8Line()).toBeUndefined();
  });

  test('returns an empty string for an empty line', async () => {
    const source = sourceOver(utf8('\nx\n'));
    expect(await source.readUtf8Line()).toBe('');
    expect(await source.readUtf8Line()).toBe('x');
  });

  test('property: lines round-trip across adversarial chunk boundaries', async () => {
    // IO-14's rationale calls out surviving slice-window boundaries; hand-picked examples miss the case
    // where \r and \n land in different chunks, so the cut points are generated.
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.stringMatching(/^[a-z \r]*$/), {maxLength: 8}),
        fc.constantFrom('\n', '\r\n'),
        fc.array(fc.integer({min: 0, max: 64}), {maxLength: 8}),
        async (lines, terminator, cuts) => {
          const encoded = utf8(
            lines.map(line => `${line}${terminator}`).join(''),
          );
          const source = BufferedSource.overStream(
            fakeReadableStream(chunkAt(encoded, cuts)),
          );

          const read: string[] = [];
          for (;;) {
            const line = await source.readUtf8Line();
            if (line === undefined) break;
            read.push(line);
          }
          // A line-content trailing \r merges with an appended \n into \r\n and is stripped by the
          // reader; with a \r\n terminator only the terminator's own \r is stripped, so a content \r
          // survives. The oracle mirrors exactly that rule.
          const expected = lines.map(line =>
            terminator === '\n' ? line.replace(/\r$/, '') : line,
          );
          expect(read).toEqual(expected);
        },
      ),
    );
  });
});
