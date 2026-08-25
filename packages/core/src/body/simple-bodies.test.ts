// SPDX-License-Identifier: MIT
// packages/core/src/body/simple-bodies.test.ts
// Exercises: HTTP-36/BODY-1 (mediaType, contentLength, replayable, writeTo), HTTP-38/BODY-35 (replayable
// by source; form-urlencoded uses "+" for space, distinct from RFC 3986 query encoding; a field value
// that cannot be rendered is raised, never dropped), HTTP-26/HTTP-51 (a media type is header-safe),
// RECOV-12 (a close failure never masks the primary write failure)
import {describe, expect, test} from 'bun:test';
import {MediaTypeParseError} from '../http/errors.js';
import {FormBodyValidationError} from './errors.js';
import {
  byteArrayBody,
  formUrlEncodedBody,
  stringBody,
} from './simple-bodies.js';

async function drain(body: {
  writeTo: (sink: WritableStream<Uint8Array>) => Promise<void>;
}): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  await body.writeTo(
    new WritableStream({write: chunk => void chunks.push(chunk)}),
  );
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

describe('ByteArrayBody', () => {
  test('reports kind, mediaType, contentLength, and is always replayable', () => {
    const body = byteArrayBody(
      Uint8Array.from([1, 2, 3]),
      'application/octet-stream',
    );
    expect(body.kind).toBe('byte-array');
    expect(body.mediaType).toBe('application/octet-stream');
    expect(body.contentLength).toBe(3);
    expect(body.replayable).toBe(true);
  });

  test('defaults mediaType to undefined -- absence is undefined, never null', () => {
    expect(byteArrayBody(Uint8Array.from([1])).mediaType).toBeUndefined();
  });

  test('writeTo emits the exact bytes, twice, byte-for-byte identical (BODY-1)', async () => {
    const body = byteArrayBody(Uint8Array.from([9, 8, 7]));
    expect([...(await drain(body))]).toEqual([9, 8, 7]);
    expect([...(await drain(body))]).toEqual([9, 8, 7]);
  });

  test('holds an independent copy -- mutating the caller array afterwards does not change it', async () => {
    const input = Uint8Array.from([1, 2, 3]);
    const body = byteArrayBody(input);
    input[0] = 99;
    expect([...(await drain(body))]).toEqual([1, 2, 3]);
  });
});

describe('StringBody', () => {
  test('encodes UTF-8 and reports the byte length, not the character length', () => {
    const body = stringBody('héllo');
    expect(body.contentLength).toBe(6); // "é" is 2 bytes in UTF-8
    expect(body.replayable).toBe(true);
  });

  test('writeTo emits the UTF-8 bytes', async () => {
    expect(new TextDecoder().decode(await drain(stringBody('hi')))).toBe('hi');
  });
});

describe('FormUrlEncodedBody (HTTP-38/BODY-35)', () => {
  test('mediaType is fixed and the body is always replayable', () => {
    const body = formUrlEncodedBody(new Map([['a', 'b']]));
    expect(body.mediaType).toBe('application/x-www-form-urlencoded');
    expect(body.replayable).toBe(true);
  });

  test('encodes space as "+" rather than "%20"', async () => {
    const body = formUrlEncodedBody(new Map([['q', 'a b']]));
    expect(new TextDecoder().decode(await drain(body))).toBe('q=a+b');
  });

  test('joins multiple params with "&", preserving insertion order', async () => {
    const body = formUrlEncodedBody(
      new Map([
        ['a', '1'],
        ['b', '2'],
      ]),
    );
    expect(new TextDecoder().decode(await drain(body))).toBe('a=1&b=2');
  });

  test('percent-encodes reserved characters in keys and values', async () => {
    const body = formUrlEncodedBody(new Map([['a&b', 'c=d']]));
    expect(new TextDecoder().decode(await drain(body))).toBe('a%26b=c%3Dd');
  });
});

function failingSink(): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    write: () => {
      throw new Error('SOCKET GONE');
    },
  });
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

describe('media types are header-safe (HTTP-26/HTTP-51)', () => {
  test('byteArrayBody rejects a media type carrying CR/LF', () => {
    expect(() =>
      byteArrayBody(Uint8Array.from([1]), 'text/plain\r\nX-Injected: pwned'),
    ).toThrow(MediaTypeParseError);
  });

  test('stringBody rejects a media type carrying a control character', () => {
    expect(() => stringBody('x', 'text/plain\u0007')).toThrow(
      MediaTypeParseError,
    );
  });

  test('a parameterised media type is still accepted', () => {
    expect(
      byteArrayBody(Uint8Array.from([1]), 'text/plain; charset=utf-8')
        .mediaType,
    ).toBe('text/plain; charset=utf-8');
  });
});

describe('a write failure is never masked by the close (RECOV-12, RETRY-2)', () => {
  test('ByteArrayBody surfaces the sink failure', () => {
    expect(
      byteArrayBody(Uint8Array.from([1, 2])).writeTo(failingSink()),
    ).rejects.toThrow('SOCKET GONE');
  });

  test('StringBody surfaces the sink failure', () => {
    expect(stringBody('hi').writeTo(failingSink())).rejects.toThrow(
      'SOCKET GONE',
    );
  });

  test('FormUrlEncodedBody surfaces the sink failure', () => {
    expect(formUrlEncodedBody({a: 'b'}).writeTo(failingSink())).rejects.toThrow(
      'SOCKET GONE',
    );
  });
});

describe('form field values (HTTP-38/BODY-35)', () => {
  test('primitives are rendered rather than dropped', async () => {
    const body = formUrlEncodedBody({count: 5, flag: true, big: 9n});
    expect(decode(await drain(body))).toBe('count=5&flag=true&big=9');
  });

  test('null renders as a valueless parameter', async () => {
    expect(decode(await drain(formUrlEncodedBody({empty: null})))).toBe(
      'empty=',
    );
  });

  test('array values render element-wise', async () => {
    expect(decode(await drain(formUrlEncodedBody({tag: ['a', 2]})))).toBe(
      'tag=a&tag=2',
    );
  });

  test('a value that cannot be rendered throws naming the field', () => {
    expect(() => formUrlEncodedBody({profile: {a: 1}} as never)).toThrow(
      FormBodyValidationError,
    );
    expect(() => formUrlEncodedBody({profile: {a: 1}} as never)).toThrow(
      /"profile"/,
    );
  });

  test('undefined is rejected too -- an absent field is never guessed at', () => {
    expect(() => formUrlEncodedBody({missing: undefined} as never)).toThrow(
      FormBodyValidationError,
    );
  });
});
