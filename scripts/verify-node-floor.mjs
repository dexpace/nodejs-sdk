// SPDX-License-Identifier: MIT
// scripts/verify-node-floor.mjs
//
// NFR-10/NFR-17 residual pulled forward from Phase 3: CI must run the *built artifact* against the
// declared minimum Node version, not just the runner default. This forces the two-signal branch of
// composeSignal() — the one that calls AbortSignal.any(), the API that landed in exactly Node
// 18.17.0, the repo's declared floor (engines.node ">=18.17").
import assert from 'node:assert/strict';
import {composeSignal} from '@dexpace/core';

const controller = new AbortController();
const combined = composeSignal(controller.signal, 50);

assert.ok(
  combined instanceof AbortSignal,
  'composeSignal() must return an AbortSignal when both a user signal and a timeout are supplied',
);
assert.notEqual(
  combined,
  controller.signal,
  'the combined signal must be a distinct AbortSignal.any() result, not the raw user signal',
);

console.log(
  `node-floor check passed: AbortSignal.any() resolved correctly on Node ${process.version}`,
);
