// SPDX-License-Identifier: MIT
// packages/transport-undici/src/challenge-handler.test.ts
// Exercises: TRANSPORT-30 -- an undispatchable custom proxy challenge handler is surfaced with a
// WARN at construction and again the first time a 407 actually arrives, proxy auth falls back to
// Basic, an origin-server 401 is never treated as a proxy challenge, and no credential is ever logged
import {afterEach, beforeEach, describe, expect, test} from 'bun:test';
import {
  createProxyOptions,
  getGlobalLogger,
  Headers,
  Protocol,
  Request,
  Response,
  setGlobalLogger,
  Status,
  type Logger,
  type ProxyOptions,
} from '@dexpace/core';
import {
  createProxyChallengeReporter,
  warnIfCustomChallengeHandler,
} from './challenge-handler.js';

/** Every field value the global logger saw, so "credentials are never logged" is checkable. */
let logged: string[] = [];
let previousLogger: Logger;

beforeEach(() => {
  logged = [];
  previousLogger = getGlobalLogger();
  const capturing: Logger = {
    atLevel: level => {
      const entry = {
        field: (key: string, value: unknown) => {
          logged.push(`${key}=${String(value)}`);
          return entry;
        },
        event: (name: string) => {
          logged.push(`event=${name}@${level}`);
          return entry;
        },
        cause: (error: unknown) => {
          logged.push(`cause=${String(error)}`);
          return entry;
        },
        emit: () => undefined,
      };
      return entry;
    },
    withContext: () => capturing,
  };
  setGlobalLogger(capturing);
});

afterEach(() => {
  setGlobalLogger(previousLogger);
});

const SECRET = 'hunter2';

function proxyWithHandler(): ProxyOptions {
  return createProxyOptions({
    type: 'http',
    host: 'proxy.internal',
    port: 8080,
    credentials: {username: 'user', password: SECRET},
    challengeHandler: () => 'Bearer minted-token',
  });
}

function makeResponse(status: number): Response {
  return Response.newBuilder()
    .request(Request.newBuilder().url('http://localhost').build())
    .protocol(Protocol.HTTP_1_1)
    .status(Status.of(status))
    .headers(Headers.newBuilder().build())
    .build();
}

describe('warnIfCustomChallengeHandler', () => {
  test('says nothing without a proxy, or with a proxy carrying no custom handler', () => {
    warnIfCustomChallengeHandler(undefined);
    warnIfCustomChallengeHandler(
      createProxyOptions({type: 'http', host: 'proxy.internal', port: 8080}),
    );
    expect(logged).toEqual([]);
  });

  test('warns at construction, naming the proxy address but never its credentials', () => {
    warnIfCustomChallengeHandler(proxyWithHandler());
    const rendered = logged.join('|');
    expect(rendered).toContain(
      'event=proxy.challengeHandler.unsupported@warning',
    );
    expect(rendered).toContain('proxy.host=proxy.internal');
    expect(rendered).toContain('proxy.port=8080');
    expect(rendered).not.toContain(SECRET);
  });
});

describe('createProxyChallengeReporter', () => {
  test('is inert when no custom handler is configured', () => {
    const report = createProxyChallengeReporter(
      createProxyOptions({type: 'http', host: 'proxy.internal', port: 8080}),
    );
    report(makeResponse(407));
    expect(logged).toEqual([]);
  });

  test('never treats an origin-server 401 as a proxy challenge', () => {
    const report = createProxyChallengeReporter(proxyWithHandler());
    report(makeResponse(401));
    report(makeResponse(200));
    expect(logged).toEqual([]);
  });

  test('warns on the first 407 and stays quiet on every one after it', () => {
    const report = createProxyChallengeReporter(proxyWithHandler());
    report(makeResponse(407));
    const afterFirst = logged.length;
    report(makeResponse(407));
    report(makeResponse(407));
    expect(logged.length).toBe(afterFirst);
    const rendered = logged.join('|');
    expect(rendered).toContain('event=proxy.challenge.unanswered@warning');
    expect(rendered).not.toContain(SECRET);
    expect(rendered).not.toContain('minted-token');
  });

  test('a logger that throws never fails the request it was describing (OBS-20)', () => {
    setGlobalLogger({
      atLevel: () => {
        throw new Error('logger exploded');
      },
      withContext: () => getGlobalLogger(),
    });
    const report = createProxyChallengeReporter(proxyWithHandler());
    expect(() => {
      report(makeResponse(407));
    }).not.toThrow();
    expect(() => {
      warnIfCustomChallengeHandler(proxyWithHandler());
    }).not.toThrow();
  });
});
