// SPDX-License-Identifier: MIT
// packages/core/src/redirect/decide.test.ts
// Exercises: XCUT-17's two clauses a plaintext conformance fixture cannot reach -- (c) userinfo embedded
// in a Location is dropped before re-issue (REDIR-12), and (d) an HTTPS-to-HTTP downgrade is denied by
// default and permitted only by explicit opt-in (REDIR-14/15). The stripping clauses (a)/(b) are asserted
// end-to-end in tests/conformance/xcut/security-by-default.conformance.test.ts.
// Exercises every numbered step of decide()'s contract: REDIR-1/REDIR-2 (the non-redirect fast path and
// the never-followed 300/304/305), REDIR-21 (a recognized 3xx always allocates the snapshot and consults
// the predicate, even with no usable Location; a non-redirect status never does), REDIR-20 (the predicate
// fully overrides code/method eligibility, over a DEFENSIVELY COPIED snapshot), REDIR-14 (relative
// resolution against the CURRENT hop), REDIR-12 (userinfo dropped), REDIR-13 (no re-encoding of an
// already-percent-encoded path/query), REDIR-18/REDIR-19 (malformed, unsupported-scheme, and
// missing/empty Location all return-current without throwing), REDIR-16 (loop detection), REDIR-17 (the
// hop cap, including maxHops: 0), REDIR-15 (the per-hop HTTPS-to-HTTP guard), REDIR-6 (the body
// replayability gate; 303 exempt), REDIR-7 (Authorization always stripped), REDIR-9/REDIR-10 (Cookie and
// Proxy-Authorization stripped only cross-origin), REDIR-11 (the marker set only on a cross-origin hop),
// REDIR-5 (the 303 GET rebuild drops the body and every Content-* header), REDIR-3/REDIR-4 (a followed
// method-preserving redirect keeps the original method).
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import type {Body} from '../body/body.js';
import {stringBody} from '../body/simple-bodies.js';
import {streamBody} from '../body/stream-body.js';
import {Headers} from '../http/headers.js';
import type {Method} from '../http/method.js';
import {Protocol} from '../http/protocol.js';
import {Request} from '../http/request.js';
import {Response} from '../http/response.js';
import {Status} from '../http/status.js';
import {CROSS_ORIGIN_MARKER_HEADER, originOf} from './cross-origin.js';
import {decide, type RedirectContext} from './decide.js';
import {NonReplayableBodyError, SchemeDowngradeError} from './errors.js';
import {redirectSettings} from './settings.js';

interface RequestOpts {
  readonly method?: Method;
  readonly url?: string;
  readonly headers?: Headers;
  readonly body?: Body;
}

function aRequest(opts: RequestOpts = {}): Request {
  const builder = Request.newBuilder()
    .method(opts.method ?? 'GET')
    .url(opts.url ?? 'https://example.com/a')
    .headers(opts.headers ?? Headers.newBuilder().build());
  return opts.body === undefined
    ? builder.build()
    : builder.body(opts.body).build();
}

/** A single-use body -- `replayable: false` is the only property the gate reads (BODY-9). */
function oneShotBody(): Body {
  return streamBody(
    new ReadableStream<Uint8Array>({
      start: c => {
        c.close();
      },
    }),
    undefined,
    0,
  );
}

/**
 * Drops exactly what the LENIENT inbound header validator rejects -- C0 controls except HTAB, plus DEL --
 * mirroring `hasForbiddenInboundValueByte`. obs-text (>= 0x80) is legal on an inbound value and must
 * reach `decide()` unfiltered, so it is deliberately kept. A code-point filter rather than a regex: the
 * equivalent character class is a literal control-character range, which `no-control-regex` rejects for
 * exactly the reason that does not apply to a deliberate sanitizer.
 */
function inboundSafe(raw: string): string {
  let out = '';
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    if ((code <= 0x1f && code !== 0x09) || code === 0x7f) continue;
    out += ch;
  }
  return out;
}

// `setInbound`, not `set`: these are RESPONSE headers, and the outbound-strict `set` rejects every
// non-ASCII byte -- which would make the totality property test below throw inside its own fixture
// rather than reaching the code under test (HTTP-19).
function aResponse(
  status: number,
  location?: string,
  extraHeaders?: Headers,
): Response {
  let headers = extraHeaders ?? Headers.newBuilder().build();
  if (location !== undefined) {
    headers = headers.newBuilder().setInbound('Location', location).build();
  }
  return Response.newBuilder()
    .request(aRequest())
    .protocol(Protocol.HTTP_1_1)
    .status(Status.of(status))
    .headers(headers)
    .body(null)
    .build();
}

function contextFor(
  request: Request,
  overrides?: Partial<RedirectContext>,
): RedirectContext {
  return {
    currentRequest: request,
    seedOrigin: originOf(request.url),
    visited: new Set([request.url.href]),
    redirectsFollowed: 0,
    ...overrides,
  };
}

describe('the shared return-current value', () => {
  test('is frozen -- one instance is handed to every caller on every no-follow path', () => {
    const decision = decide(
      aResponse(200),
      contextFor(aRequest()),
      redirectSettings(),
    );
    expect(Object.isFrozen(decision)).toBe(true);
  });
});

describe('fast path', () => {
  test('a non-3xx status returns-current without consulting anything (REDIR-1/REDIR-21)', () => {
    let consulted = false;
    const settings = redirectSettings({
      predicate: () => {
        consulted = true;
        return true;
      },
    });
    const decision = decide(aResponse(200), contextFor(aRequest()), settings);
    expect(decision).toEqual({kind: 'return-current'});
    expect(consulted).toBe(false);
  });

  test('300/304/305 are never followed even with a Location header (REDIR-2)', () => {
    for (const status of [300, 304, 305]) {
      const decision = decide(
        aResponse(status, 'https://example.com/b'),
        contextFor(aRequest()),
        redirectSettings(),
      );
      expect(decision).toEqual({kind: 'return-current'});
    }
  });
});

describe('predicate override', () => {
  test('a configured predicate REPLACES code/method eligibility (REDIR-20)', () => {
    const settings = redirectSettings({predicate: () => true});
    const decision = decide(
      aResponse(301, 'https://example.com/b'),
      contextFor(aRequest({method: 'POST'})),
      settings,
    );
    expect(decision.kind).toBe('follow');
  });

  test('a predicate is consulted even with no usable Location (REDIR-21)', () => {
    let observed = false;
    const settings = redirectSettings({
      predicate: condition => {
        observed = true;
        expect(condition.redirectsFollowed).toBe(0);
        expect(condition.visited.has('https://example.com/a')).toBe(true);
        return true;
      },
    });
    const decision = decide(aResponse(301), contextFor(aRequest()), settings);
    expect(observed).toBe(true);
    expect(decision).toEqual({kind: 'return-current'}); // still no Location to follow to
  });

  test('a predicate saying no wins over an otherwise-eligible code/method', () => {
    const settings = redirectSettings({predicate: () => false});
    const decision = decide(
      aResponse(301, 'https://example.com/b'),
      contextFor(aRequest({method: 'GET'})),
      settings,
    );
    expect(decision).toEqual({kind: 'return-current'});
  });

  test('the condition snapshot is a defensive COPY -- a predicate cannot poison loop detection', () => {
    const live = new Set(['https://example.com/a']);
    const settings = redirectSettings({
      predicate: condition => {
        // A predicate that casts the readonly type away and tries to pre-seed the visited set.
        (condition.visited as Set<string>).add('https://example.com/b');
        return true;
      },
    });
    const context = contextFor(aRequest(), {visited: live});
    const decision = decide(
      aResponse(302, 'https://example.com/b'),
      context,
      settings,
    );

    expect(decision.kind).toBe('follow'); // the injected entry never reached the live set, so /b is unvisited
    expect(live.has('https://example.com/b')).toBe(false);
  });

  test('the predicate does NOT bypass the safety mechanics (see the Deviation Ledger)', () => {
    // A predicate opting into a 307 re-send cannot make a single-use body replayable.
    const request = Request.newBuilder()
      .method('POST')
      .url('https://example.com/a')
      .body(oneShotBody())
      .build();
    const decision = decide(
      aResponse(307, 'https://example.com/b'),
      contextFor(request),
      redirectSettings({predicate: () => true}),
    );
    expect(decision.kind).toBe('fail');
  });
});

describe('Location resolution', () => {
  test('a relative Location resolves against the current request URL (REDIR-14)', () => {
    const decision = decide(
      aResponse(302, '/next'),
      contextFor(aRequest({url: 'https://example.com/a/b'})),
      redirectSettings(),
    );
    expect(decision.kind).toBe('follow');
    if (decision.kind === 'follow') {
      expect(decision.nextRequest.url.href).toBe('https://example.com/next');
    }
  });

  test('an absolute Location is used as-is (REDIR-14)', () => {
    const decision = decide(
      aResponse(302, 'https://other.example/x'),
      contextFor(aRequest()),
      redirectSettings(),
    );
    expect(decision.kind).toBe('follow');
    if (decision.kind === 'follow') {
      expect(decision.nextRequest.url.href).toBe('https://other.example/x');
    }
  });

  test('userinfo embedded in the Location is dropped unconditionally (REDIR-12)', () => {
    const decision = decide(
      aResponse(302, 'https://user:pass@other.example/x'),
      contextFor(aRequest()),
      redirectSettings(),
    );
    expect(decision.kind).toBe('follow');
    if (decision.kind === 'follow') {
      expect(decision.nextRequest.url.username).toBe('');
      expect(decision.nextRequest.url.password).toBe('');
      expect(decision.nextRequest.url.href).toBe('https://other.example/x');
    }
  });

  test('an already-encoded path/query is never re-encoded (REDIR-13)', () => {
    const decision = decide(
      aResponse(302, 'https://example.com/a%2Fb?q=x%26y'),
      contextFor(aRequest()),
      redirectSettings(),
    );
    expect(decision.kind).toBe('follow');
    if (decision.kind === 'follow') {
      expect(decision.nextRequest.url.pathname).toBe('/a%2Fb');
      expect(decision.nextRequest.url.search).toBe('?q=x%26y');
    }
  });

  test('a bracketed IPv6 host and explicit port survive resolution (REDIR-13)', () => {
    const decision = decide(
      aResponse(302, 'https://[2001:db8::1]:8443/x'),
      contextFor(aRequest()),
      redirectSettings(),
    );
    expect(decision.kind).toBe('follow');
    if (decision.kind === 'follow') {
      expect(decision.nextRequest.url.hostname).toBe('[2001:db8::1]');
      expect(decision.nextRequest.url.port).toBe('8443');
    }
  });
});

describe('Location resolution -- the unfollowed paths', () => {
  test('a missing Location returns-current (REDIR-19)', () => {
    expect(
      decide(aResponse(302), contextFor(aRequest()), redirectSettings()),
    ).toEqual({
      kind: 'return-current',
    });
  });

  test('an empty Location returns-current (REDIR-19)', () => {
    expect(
      decide(aResponse(302, ''), contextFor(aRequest()), redirectSettings()),
    ).toEqual({
      kind: 'return-current',
    });
  });

  test('an unparseable absolute Location returns-current rather than throwing (REDIR-18)', () => {
    // A malformed ABSOLUTE form is the narrow case `new URL(raw, base)` actually throws on.
    expect(
      decide(
        aResponse(302, 'http://['),
        contextFor(aRequest()),
        redirectSettings(),
      ),
    ).toEqual({
      kind: 'return-current',
    });
  });

  test('an unsupported scheme is returned unfollowed, never dispatched (REDIR-18)', () => {
    for (const raw of [
      'javascript:alert(1)',
      'data:text/html,x',
      'file:///etc/passwd',
      'mailto:a@b.c',
    ]) {
      expect(
        decide(aResponse(302, raw), contextFor(aRequest()), redirectSettings()),
      ).toEqual({
        kind: 'return-current',
      });
    }
  });
});

describe('Location resolution -- totality and configuration', () => {
  test('garbage that parses as a RELATIVE reference is followed, percent-encoded (REDIR-14)', () => {
    // Documents WHATWG `URL` behavior deliberately: with a base supplied, a non-URL string is a
    // relative reference, not a parse failure. The server said to go there, so we go there.
    const decision = decide(
      aResponse(302, ' not a url'),
      contextFor(aRequest()),
      redirectSettings(),
    );
    expect(decision.kind).toBe('follow');
    if (decision.kind === 'follow') {
      expect(decision.nextRequest.url.href).toBe(
        'https://example.com/not%20a%20url',
      );
    }
  });

  test('the location header is configurable (REDIR-27)', () => {
    const headers = Headers.newBuilder()
      .setInbound('X-Redirect-To', 'https://example.com/b')
      .build();
    const response = aResponse(302, undefined, headers);
    const decision = decide(
      response,
      contextFor(aRequest()),
      redirectSettings({locationHeader: 'X-Redirect-To'}),
    );
    expect(decision.kind).toBe('follow');
    if (decision.kind === 'follow') {
      expect(decision.nextRequest.url.href).toBe('https://example.com/b');
    }
  });

  test('property: decide() never throws for arbitrary garbage in Location (REDIR-18)', () => {
    fc.assert(
      fc.property(fc.string(), raw => {
        expect(() =>
          decide(
            aResponse(302, inboundSafe(raw)),
            contextFor(aRequest()),
            redirectSettings(),
          ),
        ).not.toThrow();
      }),
    );
  });
});

describe('loop detection', () => {
  test('a Location matching an already-visited URI returns-current (REDIR-16)', () => {
    const context = contextFor(aRequest({url: 'https://example.com/a'}), {
      visited: new Set(['https://example.com/a', 'https://example.com/b']),
    });
    expect(
      decide(
        aResponse(302, 'https://example.com/b'),
        context,
        redirectSettings(),
      ),
    ).toEqual({
      kind: 'return-current',
    });
  });

  test('a self-referencing Location returns-current (REDIR-16)', () => {
    const context = contextFor(aRequest({url: 'https://example.com/a'}));
    expect(
      decide(
        aResponse(302, 'https://example.com/a'),
        context,
        redirectSettings(),
      ),
    ).toEqual({
      kind: 'return-current',
    });
  });
});

describe('hop cap', () => {
  test('following would exceed maxHops -> return-current (REDIR-17)', () => {
    const context = contextFor(aRequest(), {redirectsFollowed: 3});
    const decision = decide(
      aResponse(302, 'https://example.com/b'),
      context,
      redirectSettings({maxHops: 3}),
    );
    expect(decision).toEqual({kind: 'return-current'});
  });

  test('maxHops: 0 fails on the very first follow attempt (REDIR-17)', () => {
    const decision = decide(
      aResponse(302, 'https://example.com/b'),
      contextFor(aRequest()),
      redirectSettings({maxHops: 0}),
    );
    expect(decision).toEqual({kind: 'return-current'});
  });

  test('property: the hop cap bounds every synthetic chain regardless of length', () => {
    fc.assert(
      fc.property(
        fc.integer({min: 0, max: 50}),
        fc.integer({min: 1, max: 10}),
        (followed, maxHops) => {
          const context = contextFor(aRequest(), {redirectsFollowed: followed});
          const decision = decide(
            aResponse(302, 'https://example.com/never-visited-before'),
            context,
            redirectSettings({maxHops}),
          );
          if (followed + 1 > maxHops) {
            expect(decision).toEqual({kind: 'return-current'});
          } else {
            expect(decision.kind).toBe('follow');
          }
        },
      ),
    );
  });
});

describe('scheme-downgrade guard', () => {
  test('HTTPS to HTTP is rejected by default (REDIR-15)', () => {
    const decision = decide(
      aResponse(302, 'http://example.com/b'),
      contextFor(aRequest({url: 'https://example.com/a'})),
      redirectSettings(),
    );
    expect(decision.kind).toBe('fail');
    if (decision.kind === 'fail') {
      expect(decision.error).toBeInstanceOf(SchemeDowngradeError);
    }
  });

  test('HTTPS to HTTP is permitted when allowSchemeDowngrade is set (REDIR-15)', () => {
    const decision = decide(
      aResponse(302, 'http://example.com/b'),
      contextFor(aRequest({url: 'https://example.com/a'})),
      redirectSettings({allowSchemeDowngrade: true}),
    );
    expect(decision.kind).toBe('follow');
  });

  test('credential stripping still applies on a permitted downgrade (REDIR-15)', () => {
    const headers = Headers.newBuilder()
      .add('Authorization', 'Bearer x')
      .build();
    const decision = decide(
      aResponse(302, 'http://example.com/b'),
      contextFor(aRequest({url: 'https://example.com/a', headers})),
      redirectSettings({allowSchemeDowngrade: true}),
    );
    expect(decision.kind).toBe('follow');
    if (decision.kind === 'follow') {
      expect(decision.nextRequest.headers.get('Authorization')).toBeUndefined();
    }
  });

  test('HTTP to HTTPS is never a downgrade', () => {
    const decision = decide(
      aResponse(302, 'https://example.com/b'),
      contextFor(aRequest({url: 'http://example.com/a'})),
      redirectSettings(),
    );
    expect(decision.kind).toBe('follow');
  });

  test('the guard is keyed to the CURRENT hop scheme, not the seed (REDIR-15)', () => {
    // Seed is http, the current hop is already https (a prior upgrade) -- a further downgrade off THIS
    // hop must still be caught even though the seed itself was http.
    const context: RedirectContext = {
      currentRequest: aRequest({url: 'https://example.com/mid'}),
      seedOrigin: originOf(new URL('http://example.com/a')),
      visited: new Set(['http://example.com/a', 'https://example.com/mid']),
      redirectsFollowed: 1,
    };
    const decision = decide(
      aResponse(302, 'http://example.com/b'),
      context,
      redirectSettings(),
    );
    expect(decision.kind).toBe('fail');
  });
});

describe('body replayability gate', () => {
  test('a method-preserving redirect with a non-replayable body fails (REDIR-6)', () => {
    const request = Request.newBuilder()
      .method('POST')
      .url('https://example.com/a')
      .body(oneShotBody())
      .build();
    const decision = decide(
      aResponse(307, 'https://example.com/b'),
      contextFor(request),
      redirectSettings({
        allowedMethods: new Set<Method>(['GET', 'HEAD', 'POST']),
      }),
    );
    expect(decision.kind).toBe('fail');
    if (decision.kind === 'fail') {
      expect(decision.error).toBeInstanceOf(NonReplayableBodyError);
    }
  });

  test('a method-preserving redirect with a replayable body follows, body preserved (REDIR-6)', () => {
    const request = Request.newBuilder()
      .method('POST')
      .url('https://example.com/a')
      .body(stringBody('x'))
      .build();
    const decision = decide(
      aResponse(307, 'https://example.com/b'),
      contextFor(request),
      redirectSettings({
        allowedMethods: new Set<Method>(['GET', 'HEAD', 'POST']),
      }),
    );
    expect(decision.kind).toBe('follow');
    if (decision.kind === 'follow') {
      expect(decision.nextRequest.body).toBeDefined();
    }
  });

  test('303 is exempt -- its body is dropped, not checked (REDIR-5/REDIR-6)', () => {
    const request = Request.newBuilder()
      .method('POST')
      .url('https://example.com/a')
      .body(oneShotBody())
      .build();
    const decision = decide(
      aResponse(303, 'https://example.com/b'),
      contextFor(request),
      redirectSettings({allow303: true}),
    );
    expect(decision.kind).toBe('follow');
    if (decision.kind === 'follow') {
      expect(decision.nextRequest.body).toBeUndefined();
    }
  });
});

describe('header construction', () => {
  test('Authorization is stripped unconditionally, even same-origin (REDIR-7)', () => {
    const headers = Headers.newBuilder()
      .add('Authorization', 'Bearer x')
      .build();
    const request = aRequest({url: 'https://example.com/a', headers});
    const decision = decide(
      aResponse(302, 'https://example.com/b'),
      contextFor(request),
      redirectSettings(),
    );
    expect(decision.kind).toBe('follow');
    if (decision.kind === 'follow') {
      expect(decision.nextRequest.headers.get('Authorization')).toBeUndefined();
    }
  });

  test('Cookie and Proxy-Authorization survive a same-origin hop (REDIR-10)', () => {
    const headers = Headers.newBuilder()
      .add('Cookie', 'a=b')
      .add('Proxy-Authorization', 'y')
      .build();
    const request = aRequest({url: 'https://example.com/a', headers});
    const decision = decide(
      aResponse(302, 'https://example.com/b'),
      contextFor(request),
      redirectSettings(),
    );
    expect(decision.kind).toBe('follow');
    if (decision.kind === 'follow') {
      expect(decision.nextRequest.headers.get('Cookie')).toBe('a=b');
      expect(decision.nextRequest.headers.get('Proxy-Authorization')).toBe('y');
    }
  });

  test('Cookie and Proxy-Authorization are stripped on a cross-origin hop (REDIR-9)', () => {
    const headers = Headers.newBuilder()
      .add('Cookie', 'a=b')
      .add('Proxy-Authorization', 'y')
      .build();
    const request = aRequest({url: 'https://example.com/a', headers});
    const decision = decide(
      aResponse(302, 'https://evil.example/b'),
      contextFor(request),
      redirectSettings(),
    );
    expect(decision.kind).toBe('follow');
    if (decision.kind === 'follow') {
      expect(decision.nextRequest.headers.get('Cookie')).toBeUndefined();
      expect(
        decision.nextRequest.headers.get('Proxy-Authorization'),
      ).toBeUndefined();
    }
  });
});

describe('header construction -- the cross-origin marker', () => {
  test('the cross-origin marker is set only on a cross-origin follow (REDIR-11)', () => {
    const sameOrigin = decide(
      aResponse(302, 'https://example.com/b'),
      contextFor(aRequest()),
      redirectSettings(),
    );
    const crossOrigin = decide(
      aResponse(302, 'https://evil.example/b'),
      contextFor(aRequest()),
      redirectSettings(),
    );
    expect(sameOrigin.kind === 'follow' && sameOrigin.crossOrigin).toBe(false);
    expect(crossOrigin.kind === 'follow' && crossOrigin.crossOrigin).toBe(true);
  });

  test('a forged inbound marker never survives a same-origin hop (REDIR-11a)', () => {
    const headers = Headers.newBuilder()
      .add('x-dexpace-internal-redirect-cross-origin', '1')
      .build();
    const request = aRequest({url: 'https://example.com/a', headers});
    const decision = decide(
      aResponse(302, 'https://example.com/b'),
      contextFor(request),
      redirectSettings(),
    );
    expect(decision.kind).toBe('follow');
    if (decision.kind === 'follow') {
      expect(
        decision.nextRequest.headers.has(
          'x-dexpace-internal-redirect-cross-origin',
        ),
      ).toBe(false);
    }
  });
});

describe('header construction -- the 303 rebuild and method preservation', () => {
  test('a 303 rebuild strips every Content-* header case-insensitively and forces GET (REDIR-5)', () => {
    const headers = Headers.newBuilder()
      .add('content-type', 'application/json')
      .add('Content-Length', '3')
      .add('CONTENT-ENCODING', 'gzip')
      .add('X-Other', 'kept')
      .build();
    const request = aRequest({
      method: 'POST',
      url: 'https://example.com/a',
      headers,
    });
    const decision = decide(
      aResponse(303, 'https://example.com/b'),
      contextFor(request),
      redirectSettings({allow303: true}),
    );
    expect(decision.kind).toBe('follow');
    if (decision.kind === 'follow') {
      expect(decision.nextRequest.method).toBe('GET');
      expect(decision.nextRequest.headers.get('Content-Type')).toBeUndefined();
      expect(
        decision.nextRequest.headers.get('Content-Length'),
      ).toBeUndefined();
      expect(
        decision.nextRequest.headers.get('Content-Encoding'),
      ).toBeUndefined();
      expect(decision.nextRequest.headers.get('X-Other')).toBe('kept');
    }
  });

  test('a 301/302/307/308 follow preserves the original method (REDIR-3/REDIR-4)', () => {
    const decision = decide(
      aResponse(307, 'https://example.com/b'),
      contextFor(
        aRequest({
          method: 'POST',
          url: 'https://example.com/a',
          body: stringBody('x'),
        }),
      ),
      redirectSettings({
        allowedMethods: new Set<Method>(['GET', 'HEAD', 'POST']),
      }),
    );
    expect(decision.kind).toBe('follow');
    if (decision.kind === 'follow') {
      expect(decision.nextRequest.method).toBe('POST');
    }
  });
});

describe('loop detection survives URL normalization', () => {
  // `visited` keys on `URL.href`, which WHATWG normalizes -- so a server cannot spin the loop past the
  // cap by varying only the case of the scheme/host or by writing the scheme's default port out. Both
  // resolve to a href already in the set. Worth pinning: if `visited` ever keyed on the raw Location
  // string instead, both of these would silently become followable and the guard would be evadable.
  test('an uppercase scheme and host still hit the visited set (REDIR-16)', () => {
    const request = aRequest({url: 'https://example.com/a'});
    expect(
      decide(
        aResponse(302, 'HTTPS://EXAMPLE.COM/a'),
        contextFor(request),
        redirectSettings(),
      ),
    ).toEqual({kind: 'return-current'});
  });

  test("the scheme's default port written explicitly still hits the visited set (REDIR-16)", () => {
    const request = aRequest({url: 'https://example.com/a'});
    expect(
      decide(
        aResponse(302, 'https://example.com:443/a'),
        contextFor(request),
        redirectSettings(),
      ),
    ).toEqual({kind: 'return-current'});
  });
});

describe('Location forms RFC 3986 resolution has to get right', () => {
  test('a protocol-relative Location inherits the scheme and is judged cross-origin (REDIR-14)', () => {
    const decision = decide(
      aResponse(302, '//other.example/x'),
      contextFor(aRequest({url: 'https://example.com/a'})),
      redirectSettings(),
    );
    expect(decision.kind).toBe('follow');
    if (decision.kind === 'follow') {
      expect(decision.nextRequest.url.href).toBe('https://other.example/x');
      expect(decision.crossOrigin).toBe(true);
    }
  });

  test('a query-only Location keeps the path and does not re-encode (REDIR-13/REDIR-14)', () => {
    const decision = decide(
      aResponse(302, '?q=a%26b'),
      contextFor(aRequest({url: 'https://example.com/a/b'})),
      redirectSettings(),
    );
    expect(decision.kind).toBe('follow');
    if (decision.kind === 'follow') {
      expect(decision.nextRequest.url.href).toBe(
        'https://example.com/a/b?q=a%26b',
      );
    }
  });

  test('dot segments resolve against the current hop (REDIR-14)', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['.', 'https://example.com/a/b/'],
      ['..', 'https://example.com/a/'],
      ['../../x', 'https://example.com/x'],
    ];
    for (const [location, expected] of cases) {
      const decision = decide(
        aResponse(302, location),
        contextFor(aRequest({url: 'https://example.com/a/b/c'})),
        redirectSettings(),
      );
      expect(decision.kind).toBe('follow');
      if (decision.kind === 'follow') {
        expect(decision.nextRequest.url.href).toBe(expected);
      }
    }
  });
});

describe('credential and marker hygiene against multi-valued headers', () => {
  test('every Authorization value is stripped, whatever its casing (REDIR-7)', () => {
    const headers = Headers.newBuilder()
      .add('authorization', 'Bearer x')
      .add('AUTHORIZATION', 'Bearer y')
      .build();
    const decision = decide(
      aResponse(302, 'https://example.com/b'),
      contextFor(aRequest({url: 'https://example.com/a', headers})),
      redirectSettings(),
    );
    expect(decision.kind).toBe('follow');
    if (decision.kind === 'follow') {
      expect(decision.nextRequest.headers.getAll('Authorization')).toEqual([]);
    }
  });

  test('a multi-valued forged marker collapses to exactly one own value (REDIR-11a)', () => {
    // Clearing must precede the conditional set. If it did not, a server that got two marker values
    // onto the request would leave the SDK appending a third rather than replacing both.
    const headers = Headers.newBuilder()
      .add(CROSS_ORIGIN_MARKER_HEADER, 'forged')
      .add(CROSS_ORIGIN_MARKER_HEADER, 'twice')
      .build();
    const decision = decide(
      aResponse(302, 'https://evil.example/b'),
      contextFor(aRequest({url: 'https://example.com/a', headers})),
      redirectSettings(),
    );
    expect(decision.kind).toBe('follow');
    if (decision.kind === 'follow') {
      expect(
        decision.nextRequest.headers.getAll(CROSS_ORIGIN_MARKER_HEADER),
      ).toEqual(['1']);
    }
  });

  test('the 303 rebuild clears an inbound marker too (REDIR-11a)', () => {
    const headers = Headers.newBuilder()
      .add(CROSS_ORIGIN_MARKER_HEADER, 'forged')
      .add('Content-Type', 'application/json')
      .build();
    const decision = decide(
      aResponse(303, 'https://example.com/b'),
      contextFor(
        aRequest({method: 'POST', url: 'https://example.com/a', headers}),
      ),
      redirectSettings({allow303: true}),
    );
    expect(decision.kind).toBe('follow');
    if (decision.kind === 'follow') {
      expect(decision.nextRequest.headers.has(CROSS_ORIGIN_MARKER_HEADER)).toBe(
        false,
      );
      expect(decision.nextRequest.headers.has('Content-Type')).toBe(false);
    }
  });
});

describe('the followed request carries the body instance itself', () => {
  test('a replayable body is re-sent, not rebuilt (REDIR-3/REDIR-4/REDIR-6)', () => {
    // The rewind is 3b's `writeTo` contract (BODY-9), not this step's -- so the step must hand the
    // SAME body across, never a copy that would have its own materialize-once state.
    const body = stringBody('x');
    const request = Request.newBuilder()
      .method('POST')
      .url('https://example.com/a')
      .body(body)
      .build();
    const decision = decide(
      aResponse(307, 'https://example.com/b'),
      contextFor(request),
      redirectSettings({
        allowedMethods: new Set<Method>(['GET', 'HEAD', 'POST']),
      }),
    );
    expect(decision.kind).toBe('follow');
    if (decision.kind === 'follow')
      expect(decision.nextRequest.body).toBe(body);
  });
});
