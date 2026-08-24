// SPDX-License-Identifier: MIT
// packages/core/src/body/multipart-body.test.ts
// Exercises: BODY-2 (composite replayability, unknown-length collapse), HTTP-51 (shared framing routine,
// boundary generation/validation, header quoting, and a part media type that cannot break the framing),
// HTTP-26 (a media type is header-safe), RECOV-12 (a close failure never masks the primary failure)
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

async function drain(body: {
  writeTo: (sink: WritableStream<Uint8Array>) => Promise<void>;
}): Promise<string> {
  const chunks: Uint8Array[] = [];
  await body.writeTo(new WritableStream({write: c => void chunks.push(c)}));
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder().decode(out);
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
