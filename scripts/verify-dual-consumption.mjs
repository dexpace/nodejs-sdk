// SPDX-License-Identifier: MIT
// scripts/verify-dual-consumption.mjs
import assert from 'node:assert/strict';
import {Status} from '@dexpace/core';

assert.equal(Status.of(200).code, 200);
assert.equal(Status.of(200).name, 'OK');
console.log(
  'dual-consumption check passed: plain Node import resolved and executed @dexpace/core',
);
