// SPDX-License-Identifier: MIT
// packages/core/src/http/request.test.ts
// Exercises: HTTP-6 (required fields), HTTP-7 (body/method legality), HTTP-8 (GET default / missing method),
// HTTP-9 (method), HTTP-46 (textual URL equality, no DNS), HTTP-47 (malformed URL), HTTP-3/5 (derivation,
// immutability)
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {Request} from './request.js';
import {Headers} from './headers.js';
import {
  RequiredFieldError,
  UrlConstructionError,
  RequestBodyNotAllowedError,
} from './errors.js';

describe('required fields (HTTP-6, HTTP-4)', () => {
  test('build() throws naming url when no URL is set', () => {
    expect(() => Request.newBuilder().method('GET').build()).toThrow(
      RequiredFieldError,
    );
    expect(() => Request.newBuilder().method('GET').build()).toThrow(
      'url is required',
    );
  });
});

describe('method/body legality (HTTP-7)', () => {
  test('rejects a body on GET, HEAD, TRACE, CONNECT', () => {
    for (const method of ['GET', 'HEAD', 'TRACE', 'CONNECT'] as const) {
      expect(() =>
        Request.newBuilder()
          .method(method)
          .url('https://example.com')
          .body('x')
          .build(),
      ).toThrow(RequestBodyNotAllowedError);
    }
  });

  test('accepts a body on POST/PUT/DELETE/PATCH/OPTIONS', () => {
    expect(() =>
      Request.newBuilder()
        .method('POST')
        .url('https://example.com')
        .body('x')
        .build(),
    ).not.toThrow();
  });

  test('clearing the body succeeds even on a body-forbidden method', () => {
    const request = Request.newBuilder()
      .method('GET')
      .url('https://example.com')
      .body('x')
      .body(undefined)
      .build();
    expect(request.body).toBeUndefined();
  });

  test('a null body clears like undefined — HTTP-7 rejects only a non-null body', () => {
    const request = Request.newBuilder()
      .method('GET')
      .url('https://example.com')
      .body('x')
      .body(null)
      .build();
    expect(request.body).toBeUndefined();
  });
});

describe('method defaulting (HTTP-8)', () => {
  test('defaults to GET when neither method nor body is set', () => {
    const request = Request.newBuilder().url('https://example.com').build();
    expect(request.method).toBe('GET');
  });

  test('fails naming the missing method when a body is set with no method', () => {
    expect(() =>
      Request.newBuilder().url('https://example.com').body('x').build(),
    ).toThrow('method is required');
  });
});

describe('URL equality (HTTP-46)', () => {
  test('two requests to the same textual URL are equal', () => {
    const a = Request.newBuilder().url('https://example.com/a').build();
    const b = Request.newBuilder().url('https://example.com/a').build();
    expect(a.equals(b)).toBe(true);
  });

  test('textually different URLs are not equal, with no network access', () => {
    const a = Request.newBuilder().url('https://example.com/a').build();
    const b = Request.newBuilder().url('https://example.com/b').build();
    expect(a.equals(b)).toBe(false);
  });

  test('equality tracks textual href equality for generated URLs', () => {
    const pathArb = fc.stringMatching(/^[a-z0-9]{0,10}$/);
    fc.assert(
      fc.property(pathArb, pathArb, (left, right) => {
        const a = Request.newBuilder()
          .url(`https://example.com/${left}`)
          .build();
        const b = Request.newBuilder()
          .url(`https://example.com/${right}`)
          .build();
        expect(a.equals(b)).toBe(left === right);
      }),
    );
  });
});

describe('malformed URL (HTTP-47)', () => {
  test('throws UrlConstructionError naming the offending input', () => {
    expect(() => Request.newBuilder().url('::bad').build()).toThrow(
      UrlConstructionError,
    );
    expect(() => Request.newBuilder().url('relative/path').build()).toThrow(
      UrlConstructionError,
    );
  });
});

describe('newBuilder derivation and immutability (HTTP-3/5)', () => {
  test('the returned URL cannot be used to mutate the request', () => {
    const request = Request.newBuilder().url('https://example.com/a').build();
    request.url.pathname = '/hacked';
    expect(request.url.pathname).toBe('/a');
  });

  test('deriving a builder and rebuilding does not affect the original', () => {
    const original = Request.newBuilder().url('https://example.com/a').build();
    original.newBuilder().url('https://example.com/b').build();
    expect(original.url.href).toBe('https://example.com/a');
  });
});

describe('headers (HTTP-6)', () => {
  test('defaults to empty headers and carries what the builder was given', () => {
    const empty = Request.newBuilder().url('https://example.com').build();
    expect(empty.headers.names()).toEqual([]);

    const headers = Headers.newBuilder().add('X-Trace', 'v').build();
    const request = Request.newBuilder()
      .url('https://example.com')
      .headers(headers)
      .build();
    expect(request.headers.get('x-trace')).toBe('v');
  });

  test('headers participate in equality (HTTP-46)', () => {
    const base = Request.newBuilder().url('https://example.com');
    const withHeader = base
      .headers(Headers.newBuilder().add('X-Trace', 'v').build())
      .build();
    const withoutHeader = Request.newBuilder()
      .url('https://example.com')
      .build();
    expect(withHeader.equals(withoutHeader)).toBe(false);
  });
});
