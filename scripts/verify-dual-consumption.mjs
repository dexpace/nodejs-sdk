// SPDX-License-Identifier: MIT
// scripts/verify-dual-consumption.mjs
//
// Every publishable package must be importable and executable by plain `node` against its BUILT
// artifact, through its package name and its `exports` map. Generalized from a core-only check in
// Phase 6a, when `@dexpace/codec-json` became the workspace's second package -- a check hard-coded
// to one package silently stops covering the workspace the moment it grows.
import assert from 'node:assert/strict';
import {
  absent,
  Headers,
  present,
  Protocol,
  Request,
  Response,
  serdeBody,
  sseStreamFrom,
  Status,
} from '@dexpace/core';
import {jsonSerde} from '@dexpace/codec-json';

import {createPinoLogger} from '@dexpace/logging-pino';
import {createDebugLogger} from '@dexpace/logging-debug';
import {fileBody} from '@dexpace/body-file';
import {
  mapOutboundHeaders,
  degradeInboundHeaders,
} from '@dexpace/transport-shared';
import {fetchTransport} from '@dexpace/transport-fetch';
import {undiciTransport} from '@dexpace/transport-undici';
import {pageItems$, pages$, sseEvents$, typedSse$} from '@dexpace/rx';
import {firstValueFrom, toArray} from 'rxjs';

assert.equal(Status.of(200).code, 200);
assert.equal(Status.of(200).name, 'OK');

// The second package, exercised end to end rather than merely imported: a bundle is built, a value
// round-trips through both halves of the seam, and the Tristate wiring that crosses the package
// boundary is the thing being encoded -- so a broken `exports` map, a missing build, or a
// dual-package brand mismatch all surface here rather than at a consumer's call time.
const serde = jsonSerde();
assert.equal(serde.mediaType, 'application/json');

const encoded = serde.serializer.serializeToString({
  keep: absent(),
  set: present('v'),
});
assert.equal(encoded, '{"set":"v"}');

const decoded = serde.deserializer.deserialize(
  serde.serializer.serialize({id: 7}),
  {schema: {parse: input => input}, typeName: 'Probe'},
);
assert.deepEqual(decoded, {id: 7});

// The core-to-codec direction of the same boundary: core's body factory driving the codec's
// serializer and stamping the codec's own declared media type (SERDE-2).
const body = serdeBody({id: 7}, serde);
assert.equal(body.mediaType, 'application/json');
assert.equal(body.replayable, true);

// Exercise logging-pino bridge
const pinoEvents = [];
const fakePino = {
  isLevelEnabled: () => true,
  error: obj => pinoEvents.push({level: 'error', obj}),
  warn: obj => pinoEvents.push({level: 'warn', obj}),
  info: obj => pinoEvents.push({level: 'info', obj}),
  debug: obj => pinoEvents.push({level: 'debug', obj}),
  trace: obj => pinoEvents.push({level: 'trace', obj}),
};
const pinoLogger = createPinoLogger(fakePino);
pinoLogger.atLevel('info').event('dual.pino').field('k', 'v').emit();
assert.equal(pinoEvents.length, 1);
assert.equal(pinoEvents[0].obj.event, 'dual.pino');

// Exercise logging-debug bridge
const debugEvents = [];
const fakeDebug = Object.assign(
  (formatter, ...args) => debugEvents.push(args.join(' ')),
  {enabled: true},
);
const debugLogger = createDebugLogger(fakeDebug);
debugLogger.atLevel('info').event('dual.debug').field('k', 'v').emit();
assert.equal(debugEvents.length, 1);
assert.ok(debugEvents[0].includes('event=dual.debug'));

// Exercise body-file
const fb = fileBody('package.json');
assert.equal(fb.kind, 'file');
assert.equal(fb.replayable, true);

// Exercise transport-shared: the outbound drop pass and the lenient inbound copy.
const outbound = mapOutboundHeaders(
  Headers.newBuilder().set('Content-Length', '10').set('X-Kept', 'v').build(),
  ['content-length'],
);
assert.ok(outbound.dropped.includes('content-length'));
assert.equal(outbound.sent.get('x-kept'), 'v');
const inbound = degradeInboundHeaders([['Content-Type', 'text/plain']]);
assert.equal(inbound.headers.get('content-type'), 'text/plain');

// Exercise both transports far enough to prove the module graph resolved and construction runs --
// not far enough to need a network. `close()` is the one lifecycle call that is safe with no peer.
// Never index with a bare `Symbol.asyncDispose` here. This gate runs on whatever `node` is on PATH,
// which includes the declared `engines.node` floor of >=20.3 -- and the symbol arrived in 20.4. On the
// floor the computed key is `undefined`, so `transport[Symbol.asyncDispose]` reads the STRING key
// `"undefined"`. That used to resolve to the junk prototype entry left by an unguarded
// `[Symbol.asyncDispose]()` class member, so this assertion passed over a transport that could not be
// disposed; since the guarded install it resolves to `undefined` and the assertion fails outright.
// Branch on the symbol, and assert the junk key's absence on BOTH legs -- the same shape
// `packages/transport-fetch/src/fetch-transport.test.ts` uses.
const asyncDispose = Symbol.asyncDispose;
for (const transport of [fetchTransport(), undiciTransport()]) {
  assert.equal(typeof transport.send, 'function');
  if (typeof asyncDispose === 'symbol') {
    assert.equal(typeof transport[asyncDispose], 'function');
    await transport[asyncDispose]();
  }
  assert.ok(
    !Object.getOwnPropertyNames(Object.getPrototypeOf(transport)).includes(
      'undefined',
    ),
    'transport prototype carries an "undefined" key: [Symbol.asyncDispose] was declared as a plain class member ahead of the floor bump',
  );
  await transport.close();
}
// Exercise @dexpace/rx bridge
const req = Request.newBuilder()
  .method('GET')
  .url('https://api.test/events')
  .build();
const sseBody = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode('data: hello\n\n'));
    controller.close();
  },
});
const sseResp = Response.newBuilder()
  .request(req)
  .status(Status.of(200))
  .protocol(Protocol.HTTP_1_1)
  .body(sseBody)
  .build();
const sseStream = sseStreamFrom(sseResp);
const events = await firstValueFrom(sseEvents$(sseStream).pipe(toArray()));
assert.equal(events.length, 1);
assert.deepEqual(events[0].data, ['hello']);
assert.equal(typeof typedSse$, 'function');
assert.equal(typeof pageItems$, 'function');
assert.equal(typeof pages$, 'function');

console.log(
  'dual-consumption check passed: plain Node import resolved and executed all packages in workspace',
);
