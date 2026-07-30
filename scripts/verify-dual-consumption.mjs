// scripts/verify-dual-consumption.mjs
import assert from 'node:assert/strict';
import {ping} from '@dexpace/core';

assert.equal(ping(), 'pong');
console.log(
  'dual-consumption check passed: plain Node import resolved and executed @dexpace/core',
);
