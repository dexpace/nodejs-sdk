// SPDX-License-Identifier: MIT
// packages/shrink-test/src/run-shrink-guard.ts
import {spawn} from 'node:child_process';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SHRINK_TEST_CONFIG} from '../shrink-test.config.js';
import {buildShrinkBundle} from './bundle.js';

/** The `NFR-9` guard's verdict: the size half and the still-runs half, reported together. */
export interface ShrinkGuardResult {
  /** Size of the minified, tree-shaken bundle. */
  readonly bundleBytes: number;
  /** The ceiling from `shrink-test.config.ts` it must not exceed. */
  readonly budgetBytes: number;
  /** True when the bundled artifact ran standalone and both of its checks passed. */
  readonly roundTripSucceeded: boolean;
}

/** Runs `runnerPath` under this process's own Node and resolves true on a clean exit. */
function runInChild(runnerPath: string): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    const child = spawn(process.execPath, [runnerPath], {stdio: 'ignore'});
    child.on('error', () => {
      resolve(false);
    });
    child.on('exit', code => {
      resolve(code === 0);
    });
  });
}

/**
 * The `NFR-9` regression guard: bundle, shrink, then actually run the result.
 *
 * The bundled code executes in a **child process**, not through `eval` or a dynamic import of this
 * one. That is the entire point of the guard rather than an implementation detail -- importing it
 * here would resolve `@dexpace/core` through this process's already-warm module graph and prove
 * nothing about the artifact standing on its own. A separate `node` sees only the bytes esbuild
 * emitted, which is what a downstream consumer ships.
 *
 * The child is spawned with `stdio: 'ignore'` and reports through its exit code alone; the runner it
 * executes exits non-zero when either fixture check comes back false, so a stripped `instanceof`
 * surfaces as a failed guard rather than as parsed output this function would have to trust.
 *
 * @returns the measured size, the configured budget, and whether the artifact still worked. The
 *   caller decides what fails the build -- see `run-shrink-guard.test.ts`.
 */
export async function runShrinkGuard(): Promise<ShrinkGuardResult> {
  const {code, bytes} = await buildShrinkBundle();
  const dir = await mkdtemp(join(tmpdir(), 'dexpace-shrink-test-'));
  try {
    const entryPath = join(dir, 'bundle.mjs');
    const runnerPath = join(dir, 'runner.mjs');
    await writeFile(entryPath, code, 'utf8');
    await writeFile(
      runnerPath,
      [
        `import {runFixtureApp} from ${JSON.stringify(entryPath)};`,
        'const result = await runFixtureApp();',
        'process.exit(result.caughtViaCoreImport && result.serdeRoundTripOk ? 0 : 1);',
        '',
      ].join('\n'),
      'utf8',
    );

    const roundTripSucceeded = await runInChild(runnerPath);
    return {
      bundleBytes: bytes,
      budgetBytes: SHRINK_TEST_CONFIG.budgetBytes,
      roundTripSucceeded,
    };
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
}
