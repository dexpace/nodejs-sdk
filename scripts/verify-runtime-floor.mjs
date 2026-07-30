// scripts/verify-runtime-floor.mjs
//
// NFR-10 / the design doc's "Runtime-floor discipline" gate: a publishable
// package's consumer-facing runtime floor (`engines.node`) and the language
// level it actually compiles to (`lib`/`target`) must be pinned *and checked
// against each other*. Raising one without the other ships syntax or built-ins
// the declared floor cannot run — a failure that surfaces at the consumer's
// call time rather than in this repo's CI, which is exactly what
// `sdk-design-nodejs/09` warns about.
//
// This reads the *effective* compiler options via `tsc --showConfig` rather
// than parsing `tsconfig.base.json` directly, because `target` is inherited
// from `gts/tsconfig-google.json` and never appears in our own config — a
// gts upgrade could move it without touching a single file in this repo.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

// The agreed pairings for this project. These are deliberate project decisions,
// not a general ES-to-Node compatibility matrix: ES2022 syntax runs on Node
// 16.11+, but the SDK declares a 18.17 floor. Adding a row here is a reviewed
// choice about what runtimes the SDK supports, never a mechanical bump.
const LANGUAGE_LEVEL_TO_NODE_FLOOR = {
  es2021: '>=16.11',
  es2022: '>=18.17',
  es2023: '>=20.0',
};

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const packagesDir = join(repoRoot, 'packages');
const tscBin = join(repoRoot, 'node_modules', '.bin', 'tsc');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function effectiveCompilerOptions(tsconfigPath) {
  const shown = execFileSync(tscBin, ['-p', tsconfigPath, '--showConfig'], {
    encoding: 'utf8',
  });
  return JSON.parse(shown).compilerOptions ?? {};
}

// `lib` carries non-ES entries too (`dom`, `esnext.disposable`); the runtime
// floor is determined by the single ES-language-level entry, so isolate it and
// insist there is exactly one.
function languageLevelFromLib(lib, packageName) {
  const esLevels = (lib ?? []).filter(entry => /^es\d{4}$/.test(entry));
  assert.equal(
    esLevels.length,
    1,
    `${packageName}: expected exactly one ES language level in \`lib\`, found ${JSON.stringify(esLevels)}`,
  );
  return esLevels[0];
}

function verifyPackage(packageDir) {
  const manifestPath = join(packageDir, 'package.json');
  const manifest = readJson(manifestPath);

  // Private packages declare no consumer-facing floor, so there is nothing to
  // reconcile. Every *publishable* package must declare one.
  if (manifest.private === true) {
    return `${manifest.name}: private, skipped`;
  }

  const declaredFloor = manifest.engines?.node;
  assert.ok(
    declaredFloor,
    `${manifest.name}: publishable package is missing \`engines.node\` (NFR-10)`,
  );

  const options = effectiveCompilerOptions(join(packageDir, 'tsconfig.json'));
  const languageLevel = languageLevelFromLib(options.lib, manifest.name);
  const target = options.target;

  assert.equal(
    target,
    languageLevel,
    `${manifest.name}: \`target\` (${target}) and \`lib\` (${languageLevel}) disagree — they must name the same ES language level`,
  );

  const expectedFloor = LANGUAGE_LEVEL_TO_NODE_FLOOR[languageLevel];
  assert.ok(
    expectedFloor,
    `${manifest.name}: no agreed Node floor for language level "${languageLevel}" — add a reviewed row to LANGUAGE_LEVEL_TO_NODE_FLOOR before compiling to it`,
  );
  assert.equal(
    declaredFloor,
    expectedFloor,
    `${manifest.name}: runtime-floor drift — compiles to ${languageLevel}, which this project pairs with engines.node "${expectedFloor}", but the package declares "${declaredFloor}". Move both together or neither.`,
  );

  return `${manifest.name}: ${languageLevel} <-> engines.node ${declaredFloor}`;
}

const packageDirs = readdirSync(packagesDir, {withFileTypes: true})
  .filter(entry => entry.isDirectory())
  .map(entry => join(packagesDir, entry.name))
  .filter(dir => existsSync(join(dir, 'package.json')));

assert.ok(packageDirs.length > 0, 'no packages found under packages/');

const results = packageDirs.map(verifyPackage);
for (const result of results) {
  console.log(`  ${result}`);
}
console.log(
  `runtime-floor check passed: ${String(results.length)} package(s) consistent`,
);
