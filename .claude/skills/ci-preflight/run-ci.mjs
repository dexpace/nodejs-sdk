// SPDX-License-Identifier: MIT
// .claude/skills/ci-preflight/run-ci.mjs
//
// Runs every blocking step of `.github/workflows/ci.yml` against the working tree, in CI's own
// order, and reports all failures at once rather than stopping at the first.
//
// Two things make this more than a shell alias for thirteen `bun run` calls:
//
//   * Ordering is load-bearing. `bun test`, `api`, `lint:publish` and every `verify:*` gate resolve
//     `@dexpace/core` by package name, which lands in `packages/core/dist/`. Run them before
//     `build` and they either fail with unresolved-module noise or, worse, pass green against
//     yesterday's artifact. CI is safe because its Build step precedes its Test step; a human
//     running gates ad hoc is not.
//   * A failed `build` invalidates the ten gates downstream of it. Running them anyway produces ten
//     spurious findings that all say "cannot resolve @dexpace/core". They are reported SKIP here,
//     so the summary names the one real defect.
//
// Logs go to node_modules/.cache/ci-preflight/<step>.log — full output stays on disk, only the
// summary and a tail of each failure reach stdout.

import {spawnSync} from 'node:child_process';
import {globSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {argv, cwd, exit, stdout, version} from 'node:process';

// Mirrors ci.yml step for step. `ci` is the workflow's own step name, so a failure here can be
// matched to the job that would have caught it. `fix` is the mechanical remedy where one exists.
const STEPS = [
  {
    id: 'install',
    ci: 'Install (frozen lockfile)',
    cmd: 'bun install --frozen-lockfile',
    tier: 'install',
    fix: 'bun install (then commit the updated bun.lock)',
  },
  {id: 'typecheck', ci: 'Typecheck', cmd: 'bun run typecheck', tier: 'build'},
  {
    id: 'lint',
    ci: 'Lint',
    cmd: 'bun run lint',
    tier: 'build',
    fix: 'bun run fix',
  },
  {id: 'build', ci: 'Build', cmd: 'bun run build', tier: 'build'},
  {
    id: 'test',
    ci: 'Test (with coverage)',
    cmd: 'bun test --coverage',
    tier: 'gate',
    // `bun test` fails the bunfig coverage floor by exit code ALONE -- it prints no threshold
    // message, and the summary above it still reads "0 fail". Read the tail without this note and
    // the obvious conclusion is that the step passed. (The `--coverage-threshold` CLI flag is
    // ignored; bunfig.toml's `coverageThreshold` is the one that gates.)
    diagnose: output =>
      /^\s*0 fail\s*$/m.test(output)
        ? 'every test passed, so this is the coverage floor in bunfig.toml (0.8), not a failing' +
          ' test. Find the file that dropped below it in the table above.'
        : null,
  },
  {
    id: 'api',
    ci: 'API surface check',
    cmd: 'bun run api',
    tier: 'gate',
    fix: 'cd packages/<pkg> && bun run api:local, then commit etc/<pkg>.api.md',
  },
  {
    id: 'lint:publish',
    ci: 'Package health (publint + attw)',
    cmd: 'bun run lint:publish',
    tier: 'gate',
  },
  {
    id: 'verify:dual-consumption',
    ci: 'Dual JS/TS consumption check',
    cmd: 'bun run verify:dual-consumption',
    tier: 'gate',
  },
  {
    id: 'verify:consumer-types',
    ci: 'Consumer typecheck against the published .d.ts',
    cmd: 'bun run verify:consumer-types',
    tier: 'gate',
  },
  {
    id: 'verify:seam-1',
    ci: 'SEAM-1 zero-dependency check',
    cmd: 'bun run verify:seam-1',
    tier: 'gate',
  },
  {
    id: 'verify:sse-37',
    ci: 'Verify SSE-37/SSE-38',
    cmd: 'bun run verify:sse-37',
    tier: 'gate',
  },
  {
    id: 'verify:runtime-floor',
    ci: 'Runtime-floor consistency check',
    cmd: 'bun run verify:runtime-floor',
    tier: 'gate',
  },
  {id: 'audit', ci: 'Dependency audit', cmd: 'bun run audit', tier: 'gate'},
  {
    id: 'test:node',
    ci: 'node-conformance (matrix)',
    cmd: 'bun run test:node',
    tier: 'gate',
  },
];

// engines.node across every publishable package, and the floor leg of ci.yml's node-conformance
// matrix. The other leg is `lts/*`, which resolves at run time and so cannot be pinned here.
const NODE_FLOOR = '20.3.0';
// Comfortably past the slowest gate (`api`, ~50s) without letting a hung one stall the run.
const STEP_TIMEOUT_MS = 10 * 60 * 1000;
const LOG_DIR = 'node_modules/.cache/ci-preflight';

function parseArgs(args) {
  const opts = {
    only: null,
    skipInstall: false,
    tail: 30,
    nodeFloor: false,
    clean: false,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--list') opts.list = true;
    else if (arg === '--skip-install') opts.skipInstall = true;
    else if (arg === '--node-floor') opts.nodeFloor = true;
    else if (arg === '--clean') opts.clean = true;
    else if (arg === '--only')
      opts.only = (args[++i] ?? '').split(',').filter(Boolean);
    else if (arg.startsWith('--only='))
      opts.only = arg.slice(7).split(',').filter(Boolean);
    else if (arg === '--tail') opts.tail = Number(args[++i]);
    else if (arg.startsWith('--tail=')) opts.tail = Number(arg.slice(7));
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else {
      console.error(`unknown argument: ${arg}\nRun with --help.`);
      exit(2);
    }
  }
  return opts;
}

const HELP = `Usage: node .claude/skills/ci-preflight/run-ci.mjs [options]

Runs every blocking step of .github/workflows/ci.yml against the working tree.

  --only a,b      Run only these step ids (see --list). Ordering and the
                  build-gates-everything rule still apply.
  --skip-install  Skip the frozen-lockfile install.
  --node-floor    Additionally run test:node under Node ${NODE_FLOOR}, CI's floor
                  leg. Needs mise, fnm, or nvm; downloads the toolchain once.
  --clean         Delete every dist/ and *.tsbuildinfo first, so the run starts
                  from the state CI checks out. Catches missing build
                  prerequisites that a warm tree hides. Costs ~40s.
  --tail N        Lines of a failing step's log to print (default 30).
  --list          List step ids and exit.

Exit code is 0 only when every step selected ran and passed.`;

function selectSteps(opts) {
  let steps = STEPS;
  if (opts.only) {
    const known = new Set(STEPS.map(s => s.id));
    const unknown = opts.only.filter(id => !known.has(id));
    if (unknown.length > 0) {
      console.error(
        `unknown step id(s): ${unknown.join(', ')}\nKnown: ${[...known].join(', ')}`,
      );
      exit(2);
    }
    steps = STEPS.filter(s => opts.only.includes(s.id));
  }
  if (opts.skipInstall) steps = steps.filter(s => s.id !== 'install');
  return steps;
}

function run(step, tail) {
  const started = Date.now();
  // `2>&1` inside the shell rather than two piped streams: spawnSync hands back stdout and stderr
  // as separate buffers, and concatenating them puts bun's own `$ script` echo *after* the compiler
  // error it preceded. The tail is the part that gets read, so it has to be in real order.
  const result = spawnSync(`${step.cmd} 2>&1`, {
    shell: true,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    // A gate CAN hang rather than fail: a `node --test` file whose teardown hook never runs holds
    // the event loop open on an unclosed server and waits forever. Without a cap the whole preflight
    // stalls behind it, which reads as "still running" and is the one outcome worse than a red run.
    timeout: STEP_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });
  const seconds = Math.round((Date.now() - started) / 1000);
  const output = `$ ${step.cmd}\n\n${result.stdout ?? ''}${result.stderr ?? ''}`;
  const log = `${LOG_DIR}/${step.id.replace(/[:/]/g, '-')}.log`;
  writeFileSync(log, output);
  const lines = output.trimEnd().split('\n');
  const timedOut =
    result.error?.code === 'ETIMEDOUT' || result.signal === 'SIGKILL';
  const ok = result.status === 0 && !timedOut;
  return {
    ...step,
    seconds,
    log,
    ok,
    timedOut,
    status: timedOut ? 'timeout' : result.status,
    note: timedOut
      ? `no output for ${STEP_TIMEOUT_MS / 60000} minutes — killed. A hang here is usually a test` +
        ' holding the event loop open (an unclosed server, a teardown hook that never ran), not a' +
        ' slow gate.'
      : (step.diagnose?.(output) ?? null),
    tail: lines.slice(-tail).join('\n'),
  };
}

function report(results, skipped, opts) {
  stdout.write('\n');
  for (const r of results) {
    const mark = r.ok ? 'PASS' : 'FAIL';
    const where = r.ok ? '' : `  ${r.log}`;
    stdout.write(
      `  ${mark}  ${r.id.padEnd(24)} ${String(r.seconds).padStart(3)}s${where}\n`,
    );
  }
  for (const s of skipped) {
    stdout.write(
      `  SKIP  ${s.id.padEnd(24)}      build failed — gate not meaningful\n`,
    );
  }

  const failed = results.filter(r => !r.ok);
  stdout.write('\n');
  if (failed.length === 0 && skipped.length === 0) {
    stdout.write(`CI preflight: all ${results.length} steps passed.\n`);
    return 0;
  }

  stdout.write(
    `CI preflight: ${failed.length} FAILED — ${failed.map(f => f.id).join(', ')}\n`,
  );
  for (const f of failed) {
    stdout.write(
      `\n${'='.repeat(72)}\n${f.id}  (ci.yml step: "${f.ci}", exit ${f.status})\n`,
    );
    if (f.note) stdout.write(`note: ${f.note}\n`);
    if (f.fix) stdout.write(`fix: ${f.fix}\n`);
    stdout.write(`${'='.repeat(72)}\n${f.tail}\n`);
    stdout.write(`[last ${opts.tail} lines; full log: ${f.log}]\n`);
  }
  return 1;
}

function runNodeFloor(opts) {
  const managers = [
    [
      'mise',
      `mise x node@${NODE_FLOOR} -- node --test test/node-conformance/*.test.mjs`,
    ],
    [
      'fnm',
      `fnm exec --using=${NODE_FLOOR} node --test test/node-conformance/*.test.mjs`,
    ],
    [
      'nvm',
      `bash -lc 'nvm exec ${NODE_FLOOR} node --test test/node-conformance/*.test.mjs'`,
    ],
  ];
  const found = managers.find(
    ([bin]) => spawnSync('command', ['-v', bin], {shell: true}).status === 0,
  );
  if (!found) {
    stdout.write(
      `\nnode-floor: no mise/fnm/nvm on PATH — Node ${NODE_FLOOR} leg not exercised.\n`,
    );
    return null;
  }
  stdout.write(
    `\nnode-floor: running test:node under Node ${NODE_FLOOR} via ${found[0]}...\n`,
  );
  return run(
    {
      id: 'test:node@floor',
      ci: `node-conformance (${NODE_FLOOR})`,
      cmd: found[1],
    },
    opts.tail,
  );
}

const opts = parseArgs(argv.slice(2));
if (opts.help) {
  stdout.write(`${HELP}\n`);
  exit(0);
}
if (opts.list) {
  for (const s of STEPS) stdout.write(`${s.id.padEnd(24)} ${s.cmd}\n`);
  exit(0);
}

// CI checks out a tree with no build artifacts in it; a working tree almost never is one. That gap
// hides a whole class of defect -- a package whose `exports` point at `dist/` being imported by name
// from another package's `src/` without anything building it first. Every gate passes locally
// against the stale `dist/` left over from the last build, and the fresh clone CI runs cannot
// resolve the module at all. Sweeping the artifacts is what makes the preflight a real rehearsal.
function cleanArtifacts() {
  const targets = [
    ...globSync('packages/*/dist'),
    ...globSync('packages/*/*.tsbuildinfo'),
  ];
  for (const target of targets) rmSync(target, {recursive: true, force: true});
  stdout.write(
    `clean: removed ${targets.length} build artifact(s) — starting from CI's state\n`,
  );
}

mkdirSync(LOG_DIR, {recursive: true});
const steps = selectSteps(opts);
if (opts.clean) cleanArtifacts();
stdout.write(
  `CI preflight — ${steps.length} step(s) from .github/workflows/ci.yml, in ${cwd()}\n`,
);

const results = [];
const skipped = [];
let buildFailed = false;
for (const step of steps) {
  if (buildFailed && step.tier === 'gate') {
    skipped.push(step);
    continue;
  }
  stdout.write(`  ... ${step.id}\n`);
  const result = run(step, opts.tail);
  results.push(result);
  if (!result.ok && step.id === 'build') buildFailed = true;
  // A frozen-lockfile failure means the dependency tree on disk is not the one CI installs.
  // Everything after it would be measuring the wrong tree.
  if (!result.ok && step.id === 'install') {
    stdout.write(
      '\ninstall failed — the tree on disk is not the tree CI builds. Stopping.\n',
    );
    break;
  }
}

if (opts.nodeFloor && !buildFailed) {
  const floor = runNodeFloor(opts);
  if (floor) results.push(floor);
} else if (!opts.nodeFloor && results.some(r => r.id === 'test:node')) {
  const major = Number(version.slice(1).split('.')[0]);
  if (major !== 20) {
    stdout.write(
      `\nnote: test:node ran on Node ${version}; CI also runs it on ${NODE_FLOOR} (the` +
        ' engines.node floor). Re-run with --node-floor to exercise that leg.\n',
    );
  }
}

exit(report(results, skipped, opts));
