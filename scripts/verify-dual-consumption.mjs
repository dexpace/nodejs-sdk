// SPDX-License-Identifier: MIT
// scripts/verify-dual-consumption.mjs
//
// Every publishable package must be importable and executable by plain `node` against its BUILT
// artifact, through its package name and its `exports` map. Generalized from a core-only check in
// Phase 6a, when `@dexpace/codec-json` became the workspace's second package -- a check hard-coded
// to one package silently stops covering the workspace the moment it grows.
import assert from 'node:assert/strict';
import {absent, present, serdeBody, Status} from '@dexpace/core';
import {jsonSerde} from '@dexpace/codec-json';

import {createPinoLogger} from '@dexpace/logging-pino';
import {createDebugLogger} from '@dexpace/logging-debug';

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
  {parse: input => input},
  'Probe',
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

console.log(
  'dual-consumption check passed: plain Node import resolved and executed all packages in workspace',
);
