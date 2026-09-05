// SPDX-License-Identifier: MIT
// packages/core/src/body/multipart-body.test.ts
// Exercises: BODY-2 (composite replayability, unknown-length collapse), HTTP-51 (shared framing routine,
// boundary generation/validation, header quoting, a boundary parameter rendered so an RFC 9110 parser
// can read it, and a part media type that cannot break the framing), HTTP-26 (a media type is
// header-safe), RECOV-12 (a close failure never masks the primary failure)
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {MediaTypeParseError} from '../http/errors.js';
import type {Body} from './body.js';
import {MultipartBoundaryError} from './errors.js';
import {
  MultipartBody,
  MultipartBodyBuilder,
  multipartBody,
} from './multipart-body.js';
import {byteArrayBody, stringBody} from './simple-bodies.js';
import {streamBody} from './stream-body.js';

function emptyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start: c => {
      c.close();
    },
  });
}

function oneByteStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(Uint8Array.from([1]));
      c.close();
    },
  });
}

/** Awaits a rejection and returns its reason, failing loudly when the promise resolves. */
async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error: unknown) {
    return error as Error;
  }
  throw new Error('expected the promise to reject, but it resolved');
}

function collectingSink(): {
  sink: WritableStream<Uint8Array>;
  written: () => Uint8Array;
} {
  const chunks: Uint8Array[] = [];
  const sink = new WritableStream<Uint8Array>({
    write: c => void chunks.push(c),
  });
  return {
    sink,
    written: () => {
      const total = chunks.reduce((sum, c) => sum + c.length, 0);
      const out = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        out.set(c, offset);
        offset += c.length;
      }
      return out;
    },
  };
}

// `Uint8Array<ArrayBuffer>`, not the bare alias: `BodyInit` excludes a view over a `SharedArrayBuffer`,
// so the default `ArrayBufferLike` parameter is not assignable to the platform `Response` below.
async function drainBytes(body: {
  writeTo: (sink: WritableStream<Uint8Array>) => Promise<void>;
}): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array[] = [];
  await body.writeTo(new WritableStream({write: c => void chunks.push(c)}));
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

async function drain(body: {
  writeTo: (sink: WritableStream<Uint8Array>) => Promise<void>;
}): Promise<string> {
  return new TextDecoder().decode(await drainBytes(body));
}

describe('MultipartBody replayability and length (BODY-2)', () => {
  test('replayable when every part is replayable', () => {
    expect(multipartBody([{name: 'a', body: stringBody('x')}]).replayable).toBe(
      true,
    );
  });

  test('not replayable when any part is not', () => {
    const body = multipartBody([
      {name: 'a', body: stringBody('x')},
      {name: 'b', body: streamBody(oneByteStream())},
    ]);
    expect(body.replayable).toBe(false);
  });

  test('declared length collapses to -1 if any part length is unknown (BODY-2)', () => {
    expect(
      multipartBody([{name: 'a', body: streamBody(emptyStream())}])
        .contentLength,
    ).toBe(-1);
  });

  test('declared length equals the bytes actually written when every part length is known', async () => {
    const body = multipartBody(
      [{name: 'a', body: stringBody('hello')}],
      'FIXEDBOUNDARY',
    );
    const rendered = await drain(body);
    expect(new TextEncoder().encode(rendered).length).toBe(body.contentLength);
  });
});

describe('MultipartBody framing and headers (HTTP-51)', () => {
  test('frames one part with boundary, headers, body, and a CRLF-terminated trailer', async () => {
    const rendered = await drain(
      multipartBody(
        [
          {
            name: 'field',
            body: byteArrayBody(new TextEncoder().encode('value')),
          },
        ],
        'B',
      ),
    );
    expect(rendered).toBe(
      '--B\r\nContent-Disposition: form-data; name="field"\r\n\r\nvalue\r\n--B--\r\n',
    );
  });

  test('includes filename and Content-Type when the part has them', async () => {
    const rendered = await drain(
      multipartBody(
        [
          {
            name: 'file',
            filename: 'a.txt',
            body: byteArrayBody(Uint8Array.from([1]), 'text/plain'),
          },
        ],
        'B',
      ),
    );
    expect(rendered).toContain('filename="a.txt"');
    expect(rendered).toContain('Content-Type: text/plain\r\n');
  });

  test('quotes/escapes a quote or backslash in a part name, and strips embedded CR/LF (HTTP-51)', async () => {
    const rendered = await drain(
      multipartBody([{name: 'a"b\\c\r\nd', body: stringBody('x')}], 'B'),
    );
    expect(rendered).toContain('name="a\\"b\\\\cd"');
  });
});

describe('MultipartBody boundary generation and validation (HTTP-51)', () => {
  test('a valid caller-supplied boundary is accepted', () => {
    expect(() =>
      multipartBody([{name: 'a', body: stringBody('x')}], 'valid-boundary_1'),
    ).not.toThrow();
  });

  test('an invalid caller-supplied boundary throws MultipartBoundaryError', () => {
    expect(() =>
      multipartBody([{name: 'a', body: stringBody('x')}], 'trailing space '),
    ).toThrow(MultipartBoundaryError);
    expect(() =>
      multipartBody([{name: 'a', body: stringBody('x')}], ''),
    ).toThrow(MultipartBoundaryError);
  });

  test('an unsupplied boundary is generated and spec-valid', () => {
    const body = multipartBody([{name: 'a', body: stringBody('x')}]);
    expect(body.mediaType).toMatch(
      /^multipart\/form-data; boundary=dexpace-[A-Za-z0-9]{32}$/,
    );
  });

  test('two generated boundaries differ', () => {
    const a = multipartBody([{name: 'a', body: stringBody('x')}]);
    const b = multipartBody([{name: 'a', body: stringBody('x')}]);
    expect(a.mediaType).not.toBe(b.mediaType);
  });
});

describe('the rendered boundary parameter is a parseable one (HTTP-51)', () => {
  // RFC 2046 `bchars` and RFC 9110 `tchar` are different sets: ' ', ',', ':', '=', '?', '/', '(' and
  // ')' are legal in a boundary and illegal bare in a header parameter value. `validateBoundary` admits
  // the first grammar and the renderer owes the second, so a boundary the constructor accepts must come
  // back out quoted rather than bare.
  test('a boundary that is not a bare token is quoted', () => {
    expect(
      multipartBody([{name: 'a', body: stringBody('x')}], 'a,b').mediaType,
    ).toBe('multipart/form-data; boundary="a,b"');
  });

  test('a boundary that IS a bare token is left unquoted', () => {
    expect(
      multipartBody([{name: 'a', body: stringBody('x')}], 'plain-1').mediaType,
    ).toBe('multipart/form-data; boundary=plain-1');
    // The generated default stays byte-identical: it is drawn from ALPHA/DIGIT only.
    expect(
      multipartBody([{name: 'a', body: stringBody('x')}]).mediaType,
    ).toMatch(/^multipart\/form-data; boundary=dexpace-[A-Za-z0-9]{32}$/);
  });

  test.each([['a,b'], ['bound ary'], ['a:b'], ['a=b'], ['a?b'], ['(a)/b']])(
    'the header a peer receives round-trips through a real parameter parser: %p',
    async boundary => {
      // The runtime's own multipart parser, standing in for the peer. Bun's happens to tolerate the
      // unquoted form, so this is the regression guard and NOT the reproducer: Node's (undici's)
      // rejects the whole body with `TypeError: Failed to parse body as FormData`, which is why the
      // same case is also in `tests/node-conformance/body-lifecycle.test.mjs`. Two independent
      // parsers disagreeing about our own Content-Type is exactly what that tree is for.
      const body = multipartBody(
        [{name: 'field', body: stringBody('value')}],
        boundary,
      );
      const response = new globalThis.Response(await drainBytes(body), {
        headers: {'content-type': body.mediaType},
      });
      expect((await response.formData()).get('field')).toBe('value');
    },
  );
});

describe('MultipartBodyBuilder (HTTP-2, HTTP-3)', () => {
  test('static newBuilder and instance newBuilder pre-populates parts and boundary', async () => {
    const original = MultipartBody.newBuilder()
      .addPart({name: 'p1', body: stringBody('v1')})
      .boundary('CUSTOMB')
      .build();

    expect(original.contentLength).toBeGreaterThan(0);

    const derived = original
      .newBuilder()
      .addPart({name: 'p2', body: stringBody('v2')})
      .build();
    expect(derived.mediaType).toBe('multipart/form-data; boundary=CUSTOMB');
    const rendered = await drain(derived);
    expect(rendered).toContain('name="p1"');
    expect(rendered).toContain('name="p2"');
  });

  test('MultipartBodyBuilder.parts sets the parts list', async () => {
    const builder = new MultipartBodyBuilder();
    builder.parts([{name: 'a', body: stringBody('1')}]);
    const body = builder.build();
    expect(await drain(body)).toContain('name="a"');
  });
});

describe('MultipartBody property tests (HTTP-51)', () => {
  test('declared length always equals the bytes written, for any part set (HTTP-51)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({name: fc.string(), content: fc.string()}), {
          minLength: 1,
          maxLength: 8,
        }),
        async specs => {
          const body = multipartBody(
            specs.map(s => ({name: s.name, body: stringBody(s.content)})),
          );
          const written = new TextEncoder().encode(await drain(body)).length;
          expect(written).toBe(body.contentLength);
        },
      ),
      {seed: 0x3b},
    );
  });

  test('a part name containing CR/LF or a quote never breaks the framing (HTTP-51)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async name => {
        const rendered = await drain(
          multipartBody(
            [{name, body: byteArrayBody(new TextEncoder().encode('x'))}],
            'B',
          ),
        );
        const headerBlock = rendered.slice(0, rendered.indexOf('\r\n\r\n'));
        // exactly two CRLFs of framing (boundary line, disposition line) -- no injected extras
        expect(headerBlock.split('\r\n').length).toBe(2);
      }),
      {seed: 0x3b},
    );
  });
});

// A hand-rolled Body bypassing the bundled factories' construction-time validation -- MultipartPart
// accepts any Body, so the framing routine cannot assume the media type was already checked.
function forgedBody(mediaType: string): Body {
  return {
    kind: 'byte-array',
    mediaType,
    contentLength: 1,
    replayable: true,
    writeTo: async sink => {
      const writer = sink.getWriter();
      await writer.write(Uint8Array.from([120]));
      await writer.close();
    },
  };
}

describe('a part media type cannot break the framing (HTTP-51)', () => {
  test('a media type carrying CR/LF is refused, not interpolated', () => {
    const part = {
      name: 'f',
      body: forgedBody('text/plain\r\nX-Injected: pwned'),
    };
    expect(() => multipartBody([part], 'BOUNDARY')).toThrow(
      MediaTypeParseError,
    );
  });

  test('a media type that would forge a closing boundary is refused', () => {
    const part = {
      name: 'f',
      body: forgedBody('text/plain\r\n\r\nSMUGGLED\r\n--BOUNDARY--'),
    };
    // Without this the declared contentLength still matches the written bytes -- the shared framing
    // routine counts the forged bytes too, so the wire is consistently, silently wrong.
    expect(() => multipartBody([part], 'BOUNDARY')).toThrow(
      MediaTypeParseError,
    );
  });
});

describe('MultipartBody failure propagation (RECOV-12)', () => {
  test('surfaces the sink failure, not a close TypeError', () => {
    const body = multipartBody([{name: 'a', body: stringBody('x')}], 'B');
    const sink = new WritableStream<Uint8Array>({
      write: () => {
        throw new Error('SOCKET GONE');
      },
    });
    expect(body.writeTo(sink)).rejects.toThrow('SOCKET GONE');
  });
});

describe('the declared length is verified against what is written (HTTP-51)', () => {
  // MultipartPart.body is the public `Body` interface, so a caller-supplied implementation can
  // report one length and write another. The shared framing routine keeps the FRAMING consistent
  // but takes each part's own contentLength on trust, which desynchronizes the value a transport
  // stamps into Content-Length from what is actually on the socket.
  function lyingBody(declared: number, actual: number): Body {
    return {
      kind: 'byte-array',
      mediaType: undefined,
      contentLength: declared,
      replayable: true,
      writeTo: async (sink: WritableStream<Uint8Array>): Promise<void> => {
        const writer = sink.getWriter();
        await writer.write(new Uint8Array(actual).fill(65));
        await writer.close();
      },
    };
  }

  test('a part that overruns its declared length is stopped before the extra bytes reach the sink', async () => {
    const {sink, written} = collectingSink();
    const body = multipartBody([{name: 'a', body: lyingBody(1, 5)}], 'B');
    const declared = body.contentLength;

    expect((await rejection(body.writeTo(sink))).name).toBe('EndOfStreamError');
    // Same reasoning as StreamBody's overrun check: once the length is stamped, a byte past it sits
    // where the peer reads it as the start of the next message.
    expect(written().length).toBeLessThanOrEqual(declared);
  });

  test('a part that writes fewer bytes than it declared fails rather than sending a short body', async () => {
    const {sink} = collectingSink();
    const body = multipartBody([{name: 'a', body: lyingBody(5, 1)}], 'B');
    expect((await rejection(body.writeTo(sink))).name).toBe('EndOfStreamError');
  });

  test('an unknown-length composite is not length-checked at all', async () => {
    // contentLength collapses to -1, so there is no declared value to disagree with.
    const body = multipartBody(
      [{name: 'a', body: streamBody(oneByteStream())}],
      'B',
    );
    expect(body.contentLength).toBe(-1);
    await body.writeTo(collectingSink().sink);
  });
});
