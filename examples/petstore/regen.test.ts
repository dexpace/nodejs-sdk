// SPDX-License-Identifier: MIT
// examples/petstore/regen.test.ts
// The regen-diff guard: re-render the frozen document and byte-compare against the checked-in
// `src/_generated/` tree. A hand-edit to a generated file — or a generator change not reflected in
// the checked-in output — fails here, so the canary can only ever be regenerated, never patched.
//
// Run with `bun test ./examples/petstore`. Deliberately NOT part of `bun run test`: the example is
// outside `packages/` and `tests/`, and the root script names only those two trees.
import {readFileSync, readdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {expect, test} from 'bun:test';
import {renderAll} from './generate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GENERATED = join(HERE, 'src', '_generated');

test('regenerating reproduces the checked-in output byte for byte', async () => {
  const rendered = await renderAll();
  expect(rendered.size).toBeGreaterThan(0);
  for (const [name, content] of rendered) {
    const checkedIn = readFileSync(join(GENERATED, name), 'utf8');
    expect(
      content,
      `${name} is out of sync; re-run \`node examples/petstore/generate.mjs\` (never hand-edit a generated file)`,
    ).toBe(checkedIn);
  }
});

test('the generator accounts for every file in src/_generated', async () => {
  const rendered = [...(await renderAll()).keys()].sort();
  const onDisk = readdirSync(GENERATED).sort();
  expect(rendered).toEqual(onDisk);
});
