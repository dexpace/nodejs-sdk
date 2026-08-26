// SPDX-License-Identifier: MIT
// scripts/verify-seam-1.mjs
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const manifestPath = fileURLToPath(
  new URL('../packages/core/package.json', import.meta.url),
);
const corePackageJson = JSON.parse(readFileSync(manifestPath, 'utf8'));

assert.deepEqual(
  corePackageJson.dependencies,
  {},
  'SEAM-1 violation: @dexpace/core must declare zero runtime dependencies',
);
console.log('SEAM-1 check passed: @dexpace/core has zero runtime dependencies');
