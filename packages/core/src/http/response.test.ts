// SPDX-License-Identifier: MIT
// packages/core/src/http/response.test.ts
// Exercises: HTTP-6 (response's required fields: request, protocol, status)
import {describe, expect, test} from 'bun:test';
import {Response} from './response.js';
import {Request} from './request.js';
import {Protocol} from './protocol.js';
import {Status} from './status.js';
import {Headers} from './headers.js';

function baseRequest(): Request {
  return Request.newBuilder().url('https://example.com').build();
}

describe('required fields', () => {
  test('throws naming request when missing', () => {
    expect(() =>
      Response.newBuilder()
        .protocol(Protocol.HTTP_1_1)
        .status(Status.of(200))
        .build(),
    ).toThrow('request is required');
  });

  test('throws naming protocol when missing', () => {
    expect(() =>
      Response.newBuilder()
        .request(baseRequest())
        .status(Status.of(200))
        .build(),
    ).toThrow('protocol is required');
  });

  test('throws naming status when missing', () => {
    expect(() =>
      Response.newBuilder()
        .request(baseRequest())
        .protocol(Protocol.HTTP_1_1)
        .build(),
    ).toThrow('status is required');
  });
});

describe('construction', () => {
  test('carries the originating request, protocol, status, headers, and an optional reason phrase/body', () => {
    const request = baseRequest();
    const response = Response.newBuilder()
      .request(request)
      .protocol(Protocol.HTTP_1_1)
      .status(Status.of(200))
      .reasonPhrase('OK')
      .body('payload')
      .build();

    expect(response.request.equals(request)).toBe(true);
    expect(response.protocol.equals(Protocol.HTTP_1_1)).toBe(true);
    expect(response.status.equals(Status.of(200))).toBe(true);
    expect(response.reasonPhrase).toBe('OK');
    expect(response.body).toBe('payload');
  });

  test('reason phrase and body are optional', () => {
    const response = Response.newBuilder()
      .request(baseRequest())
      .protocol(Protocol.HTTP_1_1)
      .status(Status.of(204))
      .build();
    expect(response.reasonPhrase).toBeUndefined();
    expect(response.body).toBeUndefined();
  });
});

describe('newBuilder derivation', () => {
  test('deriving a builder and rebuilding does not affect the original', () => {
    const original = Response.newBuilder()
      .request(baseRequest())
      .protocol(Protocol.HTTP_1_1)
      .status(Status.of(200))
      .build();
    original.newBuilder().status(Status.of(500)).build();
    expect(original.status.code).toBe(200);
  });
});

describe('headers (HTTP-6)', () => {
  test('defaults to empty headers and carries what the builder was given', () => {
    const bare = Response.newBuilder()
      .request(baseRequest())
      .protocol(Protocol.HTTP_1_1)
      .status(Status.of(204))
      .build();
    expect(bare.headers.names()).toEqual([]);

    const response = bare
      .newBuilder()
      .headers(Headers.newBuilder().add('Content-Type', 'text/plain').build())
      .build();
    expect(response.headers.get('content-type')).toBe('text/plain');
    expect(bare.headers.has('content-type')).toBe(false);
  });
});
