// SPDX-License-Identifier: MIT
// packages/core/src/seams/operation.test.ts
// Exercises: SEAM-26 (the four projections default to empty), SEAM-27 (buildRequest's encoding and base-URL
// composition rules), reusing HTTP-29's encodeRfc3986Component for path-segment encoding.
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {
  buildRequest,
  OperationAssemblyError,
  type OperationDescriptor,
} from './operation.js';
import {UrlConstructionError} from '../http/errors.js';
import {QueryParams} from '../http/query-params.js';
import {Headers} from '../http/headers.js';

describe('SEAM-26: a parameterless GET overriding only method+path', () => {
  test('assembles a well-formed request with empty headers and no query', () => {
    const request = buildRequest('https://api.example.com', {
      method: 'GET',
      pathTemplate: '/pets',
    });
    expect(request.method).toBe('GET');
    expect(request.url.href).toBe('https://api.example.com/pets');
    expect(request.headers.names()).toEqual([]);
    expect(request.body).toBeUndefined();
  });
});

describe('SEAM-27: worked example', () => {
  test('host/c?sig=.. + /pets assembles to host/c/pets?sig=..&<opquery>', () => {
    const operation: OperationDescriptor = {
      method: 'GET',
      pathTemplate: '/pets',
      query: QueryParams.newBuilder().add('limit', '10').build(),
    };
    const request = buildRequest('https://host/c?sig=abc', operation);
    expect(request.url.pathname).toBe('/c/pets');
    expect(request.url.search).toBe('?sig=abc&limit=10');
  });
});

describe('SEAM-27: base-URL composition rules', () => {
  test('a trailing slash on the base normalizes to one separator', () => {
    const request = buildRequest('https://host/c/', {
      method: 'GET',
      pathTemplate: '/pets',
    });
    expect(request.url.pathname).toBe('/c/pets');
  });

  test('an empty operation path leaves the base untouched', () => {
    const request = buildRequest('https://host/c', {
      method: 'GET',
      pathTemplate: '',
    });
    expect(request.url.pathname).toBe('/c');
  });

  test('an existing base query is preserved with the operation query appended after it', () => {
    const operation: OperationDescriptor = {
      method: 'GET',
      pathTemplate: '/pets',
      query: QueryParams.newBuilder().add('a', '1').build(),
    };
    const request = buildRequest('https://host/c?existing=yes', operation);
    expect(request.url.search).toBe('?existing=yes&a=1');
  });

  test("a dangling separator on the base query is dropped before appending (SEAM-27's parenthetical)", () => {
    const operation: OperationDescriptor = {
      method: 'GET',
      pathTemplate: '/pets',
      query: QueryParams.newBuilder().add('a', '1').build(),
    };
    const request = buildRequest('https://host/c?existing=yes&', operation);
    expect(request.url.search).toBe('?existing=yes&a=1');
  });

  test('a fragment-bearing base is rejected', () => {
    expect(() =>
      buildRequest('https://host/c#frag', {
        method: 'GET',
        pathTemplate: '/pets',
      }),
    ).toThrow(UrlConstructionError);
  });

  test('a malformed base is rejected', () => {
    expect(() =>
      buildRequest('::bad', {method: 'GET', pathTemplate: '/pets'}),
    ).toThrow(UrlConstructionError);
  });

  test('a missing placeholder value throws OperationAssemblyError', () => {
    expect(() =>
      buildRequest('https://host', {method: 'GET', pathTemplate: '/pets/{id}'}),
    ).toThrow(OperationAssemblyError);
  });
});

describe('operation headers and body projections are threaded through', () => {
  test('supplied headers and body appear on the built request', () => {
    const headers = Headers.newBuilder().add('X-Trace', 'abc').build();
    const request = buildRequest('https://host', {
      method: 'POST',
      pathTemplate: '/pets',
      headers,
      body: {name: 'Fido'},
    });
    expect(request.headers.get('x-trace')).toBe('abc');
    expect(request.body).toEqual({name: 'Fido'});
  });
});

describe('SEAM-27: dot-segment path-param values are rejected, not silently normalized away', () => {
  // "." and ".." survive RFC 3986 encoding (both are unreserved), and the WHATWG URL parser treats "%2E" the
  // same as "." when it normalizes dot segments — so no encoding can keep them literal. A value of ".." would
  // otherwise rewrite the path (/things/.. → /), the same injection class SEAM-27's %2F rule exists to stop.
  test('a path-param value of "." throws OperationAssemblyError', () => {
    expect(() =>
      buildRequest('https://host', {
        method: 'GET',
        pathTemplate: '/things/{id}',
        pathParams: {id: '.'},
      }),
    ).toThrow(OperationAssemblyError);
  });

  test('a path-param value of ".." throws OperationAssemblyError', () => {
    expect(() =>
      buildRequest('https://host', {
        method: 'GET',
        pathTemplate: '/things/{id}',
        pathParams: {id: '..'},
      }),
    ).toThrow(OperationAssemblyError);
  });
});

describe('a path-param value containing / is encoded, not split (property)', () => {
  test('holds for arbitrary generated path-param values', () => {
    fc.assert(
      fc.property(
        // "." and ".." are excluded here because buildRequest rejects them by design — the two example tests
        // above pin that behavior; every other string must survive as exactly one path segment.
        fc
          .string({minLength: 1, maxLength: 20})
          .filter(s => s !== '.' && s !== '..'),
        value => {
          const request = buildRequest('https://host', {
            method: 'GET',
            pathTemplate: '/things/{id}',
            pathParams: {id: value},
          });
          const segments = request.url.pathname
            .split('/')
            .filter(segment => segment !== '');
          expect(segments.length).toBe(2);
          expect(segments[0]).toBe('things');
        },
      ),
    );
  });
});
