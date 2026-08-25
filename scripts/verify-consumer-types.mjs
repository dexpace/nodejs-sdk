// SPDX-License-Identifier: MIT
// scripts/verify-consumer-types.mjs
//
// Compiles a throwaway consumer against the BUILT `.d.ts` using the same `lib` and `target` this
// workspace declares, with `types: []` so nothing from devDependencies leaks in.
//
// This gate exists because a real defect got all the way through every other one. `Response` shipped
// an `async [Symbol.asyncDispose]()` that type-checked in-repo only because `@types/bun` — a
// dev-only global — supplies the symbol. A consumer on `lib: ["ES2022", "DOM"]`, which is what this
// workspace itself declares, got `TS2550: Property 'asyncDispose' does not exist on type
// 'SymbolConstructor'` and could not build at all. `typecheck` passed (dev types present), `build`
// passed, `api` passed, `lint:publish` passed (publint and attw check resolution and export shape,
// not whether the declarations resolve), and `verify:dual-consumption` passed because it runs `node`,
// not `tsc`.
//
// The `lib`/`target` are read from tsconfig.base.json rather than hardcoded, so the gate tracks the
// declared baseline instead of drifting away from it.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const base = JSON.parse(
  readFileSync(join(repoRoot, 'tsconfig.base.json'), 'utf8'),
);
const {lib, target} = base.compilerOptions;
assert.ok(
  Array.isArray(lib) && lib.length > 0,
  'tsconfig.base.json must declare a lib array',
);

const built = join(repoRoot, 'packages', 'core', 'dist', 'index.js');
const tsc = join(repoRoot, 'node_modules', '.bin', 'tsc');

// Checked up front, not left to the catch below. A missing prerequisite reported through the
// type-failure path would read as "the published .d.ts is broken", which is the one message this
// gate must never send falsely.
assert.ok(
  existsSync(tsc),
  `tsc not found at ${tsc} — run \`bun install\` before this gate`,
);
assert.ok(
  existsSync(built),
  `built package not found at ${built} — run \`bun run build\` before this gate`,
);
const workDir = mkdtempSync(join(tmpdir(), 'dexpace-consumer-types-'));

// Exercises the surface most likely to reference a declaration the consumer's lib cannot resolve:
// the resource-owning class, an async iterable/stream type, a generic, and a factory.
const consumer = `
import {
  type Body,
  byteArrayBody,
  materialize,
  Response,
  Status,
  toHttpError,
  TypedResponse,
} from ${JSON.stringify(built)};

export function readBody(response: Response): Promise<string> {
  return response.text();
}
export function release(response: Response): Promise<void> {
  return response.close();
}
export function stream(response: Response): ReadableStream<Uint8Array> | null {
  return response.body;
}
export function replay(body: Body): Promise<Body> {
  return materialize(body);
}
export function typed(wrapper: TypedResponse<number>): Promise<number> {
  return wrapper.value();
}
export const bytes: Body = byteArrayBody(new Uint8Array([1]), 'application/octet-stream');
export const errorOf = toHttpError;
export const ok: number = Status.of(200).code;
`;

const tsconfig = {
  compilerOptions: {
    target,
    lib,
    module: 'nodenext',
    moduleResolution: 'nodenext',
    strict: true,
    noEmit: true,
    // The whole point: no ambient globals from devDependencies. A consumer installing this package
    // gets exactly `lib` plus whatever they install themselves.
    types: [],
    skipLibCheck: false,
  },
  include: ['consumer.ts'],
};

try {
  writeFileSync(join(workDir, 'consumer.ts'), consumer);
  writeFileSync(
    join(workDir, 'tsconfig.json'),
    JSON.stringify(tsconfig, null, 2),
  );

  execFileSync(tsc, ['-p', join(workDir, 'tsconfig.json')], {
    stdio: 'pipe',
    encoding: 'utf8',
  });
} catch (error) {
  const detail = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
  console.error(
    'consumer-types check FAILED: the published .d.ts does not compile against this workspace\n' +
      `own declared lib (${lib.join(', ')}) with types: [].\n\n${detail}\n\n` +
      'A declaration is reaching for a global that only a devDependency supplies. Either drop it, or\n' +
      'add the lib entry to tsconfig.base.json and raise engines.node to a runtime that has it.',
  );
  process.exit(1);
} finally {
  rmSync(workDir, {recursive: true, force: true});
}

console.log(
  `consumer-types check passed: dist/*.d.ts compiles on lib [${lib.join(', ')}] with types: []`,
);
