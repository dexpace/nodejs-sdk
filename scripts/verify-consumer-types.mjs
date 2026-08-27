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
//
// It ALSO names every type the pillar-authoring surface promoted in Phase 5c, because a second defect
// got through every other gate too: an `@internal` token inside a prose comment above the barrel's
// context-family export made `stripInternal` delete that export from the emitted `.d.ts`. `typecheck`
// passed (the source says it is exported), `build` passed (tsc emitted happily), and `api:ci` passed
// because api-extractor recorded the resulting `ae-forgotten-export` as report TEXT. Nothing compiled
// the promoted names from outside the package, so nothing noticed. Naming them here is what makes
// that class of silent elision loud.
const consumer = `
import {
  ApiKeyCredential,
  type ApiKeyCredentialConfig,
  AuthResolutionError,
  type AuthCredentialSet,
  type AuthDescriptor,
  type AuthRequirement,
  type AuthScheme,
  type AuthStepSettings,
  type AuthTiers,
  authRequirementsEqual,
  authStep,
  type BackoffSettings,
  type BasicCredential,
  type BearerCredential,
  BearerToken,
  bearerTokensEqual,
  type Body,
  byteArrayBody,
  type ChallengeHook,
  type Clock,
  createAuthDescriptor,
  createAuthRequirement,
  createBearerToken,
  type DigestAlgorithm,
  type DigestCredential,
  type DispatchContext,
  type ExchangeContext,
  type ExecutionContext,
  type InstrumentationBundle,
  materialize,
  NameKeyCredential,
  type Next,
  PILLAR_STAGES,
  PipelineBuilder,
  PlaintextCredentialError,
  type RedirectCondition,
  type RedirectPredicate,
  type RedirectSettings,
  redirectStep,
  Request,
  type RequestContext,
  Response,
  type RetrySettings,
  type RetryStepOptions,
  retryStep,
  Runtime,
  type Stage,
  STAGE_ORDER,
  type StandardResilienceOptions,
  standardResilience,
  Status,
  type Step,
  type StepContext,
  type StepDescriptor,
  toHttpError,
  type TokenProvider,
  type Transport,
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

// --- the pillar-authoring surface promoted in Phase 5c ---
export function kindOf(context: ExecutionContext): string {
  return context.kind;
}
export function dispatchKey(context: DispatchContext): symbol {
  return context.key;
}
export function requestOf(context: RequestContext): Request {
  return context.request;
}
export function responseOf(context: ExchangeContext): Response {
  return context.response;
}
export function traceOf(bundle: InstrumentationBundle): string {
  return bundle.traceId;
}
export const customStep: Step = async (request, ctx: StepContext) => {
  const advance: Next = ctx.fork?.() ?? ctx.next;
  kindOf(ctx.context);
  return advance(request);
};
export const descriptor: StepDescriptor = {
  type: Symbol('consumer.custom'),
  stage: 'PRE_AUTH' satisfies Stage,
  fn: customStep,
};
export const stageCount: number = STAGE_ORDER.length + PILLAR_STAGES.size;

export function assemble(transport: Transport): Runtime {
  const provider: TokenProvider = async () => createBearerToken('t', Date.now() + 60_000);
  const settings: AuthStepSettings = {
    credentials: {
      apiKey: {credential: new ApiKeyCredential('k'), prefix: 'ApiKey'},
      basic: {username: 'u', password: 'p'},
      digest: {username: 'u', password: 'p', algorithmPreference: ['SHA-256' satisfies DigestAlgorithm]},
      bearer: {provider, marginMs: 5_000},
    },
    tiers: {
      client: createAuthDescriptor([
        createAuthRequirement('OAUTH2' satisfies AuthScheme, ['scope.read']),
        createAuthRequirement('NO_AUTH'),
      ]),
    } satisfies AuthTiers,
    challengeHook: (async () => undefined) satisfies ChallengeHook,
    bearerMarginMs: 30_000,
    clock: {now: () => Date.now()},
  };
  const options: StandardResilienceOptions = {
    auth: settings,
    retry: {settings: {maxAttempts: 3}} satisfies RetryStepOptions,
    redirect: {maxHops: 2},
  };
  const hand = new PipelineBuilder(transport)
    .append(redirectStep({maxHops: 2}))
    .append(retryStep())
    .append(authStep(settings))
    .append(descriptor)
    .build();
  const seeded = PipelineBuilder.seedFrom(hand, 'nest').build();
  return standardResilience(seeded, options);
}

export function requirementEquality(a: AuthRequirement, b: AuthRequirement): boolean {
  return authRequirementsEqual(a, b);
}
export function tokenEquality(a: BearerToken, b: BearerToken): boolean {
  return bearerTokensEqual(a, b);
}
export function describeDescriptor(d: AuthDescriptor): boolean {
  return d.allowsAnonymous;
}
export function nameKey(): NameKeyCredential {
  return new NameKeyCredential('x-api-key', 'k');
}
export function narrow(error: unknown): string | undefined {
  if (error instanceof PlaintextCredentialError) return error.scheme;
  if (error instanceof AuthResolutionError) return error.requiredSchemes?.[0];
  return undefined;
}
export function credentialSet(set: AuthCredentialSet): BasicCredential | undefined {
  return set.basic;
}
export function bearerCredential(c: BearerCredential): TokenProvider {
  return c.provider;
}
export function digestCredential(c: DigestCredential): string {
  return c.username;
}
export function apiKeyConfig(c: ApiKeyCredentialConfig): string | undefined {
  return c.headerName;
}
export function redirectPolicy(s: RedirectSettings, p: RedirectPredicate): boolean {
  return p({response: undefined as unknown as Response, redirectsFollowed: s.maxHops, visited: new Set()});
}
export function retryPolicy(s: RetrySettings, b: BackoffSettings): number {
  return s.maxAttempts + b.initialDelayMs;
}
export function clockNow(c: Clock): number {
  return c.now();
}
export function conditionOf(c: RedirectCondition): number {
  return c.redirectsFollowed;
}
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
    "consumer-types check FAILED: the published .d.ts does not compile against this workspace's\n" +
      `own declared lib (${lib.join(', ')}) with types: [].\n\n${detail}\n\n` +
      'Either a declaration is reaching for a global that only a devDependency supplies (drop it, or\n' +
      'add the lib entry to tsconfig.base.json and raise engines.node to a runtime that has it), or\n' +
      'the barrel claims an export the emitted .d.ts does not actually carry -- check for an\n' +
      '`@internal` token inside a comment above the export, which `stripInternal` deletes it for.',
  );
  process.exit(1);
} finally {
  rmSync(workDir, {recursive: true, force: true});
}

console.log(
  `consumer-types check passed: dist/*.d.ts compiles on lib [${lib.join(', ')}] with types: [],\n` +
    'including every symbol the pillar-authoring surface promotes.',
);
