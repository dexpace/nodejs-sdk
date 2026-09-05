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
const builtCodecJson = join(
  repoRoot,
  'packages',
  'codec-json',
  'dist',
  'index.js',
);
const builtLoggingPino = join(
  repoRoot,
  'packages',
  'logging-pino',
  'dist',
  'index.js',
);
const builtLoggingDebug = join(
  repoRoot,
  'packages',
  'logging-debug',
  'dist',
  'index.js',
);
const builtBodyFile = join(
  repoRoot,
  'packages',
  'body-file',
  'dist',
  'index.js',
);
const builtTransportShared = join(
  repoRoot,
  'packages',
  'transport-shared',
  'dist',
  'index.js',
);
const builtTransportFetch = join(
  repoRoot,
  'packages',
  'transport-fetch',
  'dist',
  'index.js',
);
const builtTransportUndici = join(
  repoRoot,
  'packages',
  'transport-undici',
  'dist',
  'index.js',
);
const builtRx = join(repoRoot, 'packages', 'rx', 'dist', 'index.js');
const tsc = join(repoRoot, 'node_modules', '.bin', 'tsc');

// Checked up front, not left to the catch below. A missing prerequisite reported through the
// type-failure path would read as "the published .d.ts is broken", which is the one message this
// gate must never send falsely.
assert.ok(
  existsSync(tsc),
  `tsc not found at ${tsc} — run \`bun install\` before this gate`,
);
for (const artifact of [
  built,
  builtCodecJson,
  builtLoggingPino,
  builtLoggingDebug,
  builtBodyFile,
  builtTransportShared,
  builtTransportFetch,
  builtTransportUndici,
  builtRx,
]) {
  assert.ok(
    existsSync(artifact),
    `built package not found at ${artifact} — run \`bun run build\` before this gate`,
  );
}
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
  absent,
  ApiKeyCredential,
  type ApiKeyCredentialConfig,
  type AuthCredentialSet,
  type AuthDescriptor,
  type AuthRequirement,
  authRequirementsEqual,
  AuthResolutionError,
  type AuthScheme,
  authStep,
  type AuthStepSettings,
  type AuthTiers,
  type BackoffSettings,
  BasicCredential,
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
  decodeResponse,
  decodeSuccessResponse,
  type DecodeTarget,
  DeserializationError,
  type DeserializationErrorOptions,
  type Deserializer,
  type DigestAlgorithm,
  DigestCredential,
  type DispatchContext,
  type ExchangeContext,
  type ExecutionContext,
  foldTristate,
  type InstrumentationBundle,
  isAbsent,
  isNull,
  isPresent,
  isSerdeError,
  isTristate,
  materialize,
  NameKeyCredential,
  type Next,
  nullValue,
  ofNullable,
  PILLAR_STAGES,
  PipelineBuilder,
  PlaintextCredentialError,
  present,
  type RedirectCondition,
  type RedirectPredicate,
  type RedirectSettings,
  redirectStep,
  Request,
  type RequestContext,
  Response,
  type RetrySettings,
  retryStep,
  type RetryStepOptions,
  Runtime,
  type Schema,
  type Serde,
  serdeBody,
  type SerdeErrorOptions,
  SerializationError,
  type Serializer,
  type Stage,
  STAGE_ORDER,
  standardResilience,
  type StandardResilienceOptions,
  Status,
  type Step,
  type StepContext,
  type StepDescriptor,
  toHttpError,
  type TokenProvider,
  type Transport,
  type Tristate,
  TRISTATE_BRAND,
  type TristateBranches,
  tristateToString,
  TypedResponse,
  valueOrNull,
  type Counter,
  type Histogram,
  type Meter,
  NOOP_METER,
  type CreateLoggerOptions,
  type LogEvent,
  type LogLevel,
  type Logger,
  NOOP_LOGGER,
  createLogger,
  getGlobalLogger,
  setGlobalLogger,
  type Scope,
  type Span,
  type SpanContext,
  type Tracer,
  NOOP_SPAN,
  NOOP_TRACER,
  activateSpan,
  activateSpanForCorrelation,
  createInstrumentationBundle,
  getActiveSpan,
  type DroppedHeaderPolicy,
  type LoggingGranularity,
  type LoggingStepSettings,
  LOGGING_STEP_TYPE,
  loggingStep,
  IoError,
  TransportFailureError,
  type FileBodyDescriptor,
} from ${JSON.stringify(built)};
import {
  jsonSerde,
  type JsonSerdeOptions,
  tristate,
  tristateObject,
  tristateReplacer,
} from ${JSON.stringify(builtCodecJson)};
import {
  createPinoLogger,
  type PinoLike,
} from ${JSON.stringify(builtLoggingPino)};
import {
  createDebugLogger,
  type DebugLike,
  type DebugFactory,
} from ${JSON.stringify(builtLoggingDebug)};
import {
  fileBody,
  type FileBodyOptions,
} from ${JSON.stringify(builtBodyFile)};
import {
  fetchTransport,
  type FetchTransportOptions,
} from ${JSON.stringify(builtTransportFetch)};
import {
  undiciTransport,
  type UndiciTransportOptions,
} from ${JSON.stringify(builtTransportUndici)};
import {
  pageItems$,
  pages$,
  sseEvents$,
  typedSse$,
} from ${JSON.stringify(builtRx)};
import type {Paginator, SseMapper, SseStream} from ${JSON.stringify(built)};


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
      basic: new BasicCredential('u', 'p'),
      digest: new DigestCredential('u', 'p', ['SHA-256' satisfies DigestAlgorithm]),
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
export function credentialSet(set: AuthCredentialSet): string | undefined {
  return set.basic?.username;
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

// --- the serde seam promoted in Phase 6a ---
export function mediaTypeOf(serde: Serde): string {
  return serde.mediaType;
}
export function encodeInto(s: Serializer, value: unknown, buf: Uint8Array): number {
  return s.serializeInto(value, buf, 0);
}
export function decodeOne<T>(d: Deserializer, data: Uint8Array, schema: Schema<T>): T {
  return d.deserialize(data, {schema, typeName: 'T'});
}
export function decodeTarget<T>(schema: Schema<T>): DecodeTarget<T> {
  return {schema, typeName: 'T'};
}
export function decodeBoth<T>(
  response: Response,
  d: Deserializer,
  target: DecodeTarget<T>,
): [Promise<T>, Promise<T>] {
  return [decodeResponse(response, d, target), decodeSuccessResponse(response, d, target)];
}
export function bodyFromSerde(serde: Serde): Body {
  return serdeBody({a: 1}, serde, 'application/merge-patch+json');
}
export function serdeErrorContext(e: unknown): number | undefined {
  // Direction is narrowed first: response context lives on the read leaf, not on the union.
  if (!isSerdeError(e)) return undefined;
  return e instanceof DeserializationError ? e.status : undefined;
}
export function newSerdeErrors(
  write: SerdeErrorOptions,
  read: DeserializationErrorOptions,
): [SerializationError, DeserializationError] {
  return [new SerializationError('w', write), new DeserializationError('r', read)];
}
export function readLeafContext(e: DeserializationError): [number | undefined, string | null] {
  return [e.status, e.etag];
}
export function tristateBranches<T>(t: Tristate<T>): string {
  const branches: TristateBranches<T, string> = {
    onAbsent: () => 'absent',
    onNull: () => 'null',
    onPresent: (value) => tristateToString(present<T>(value as NonNullable<T>)),
  };
  return foldTristate(t, branches);
}
export function tristateStates(): readonly [Tristate<number>, Tristate<number>, Tristate<number>] {
  return [absent(), nullValue(), present(1)];
}
export function tristateNarrowing(t: Tristate<string>): string | null {
  if (isAbsent(t) || isNull(t)) return valueOrNull(t);
  if (isPresent(t)) return t.value;
  return null;
}
export function tristateFromNullable(v: string | null): Tristate<string> {
  return ofNullable(v);
}
export function brandedRecognition(v: unknown): boolean {
  return isTristate(v) && TRISTATE_BRAND in (v as object);
}

// --- @dexpace/codec-json, the workspace's second publishable package ---
export function jsonBundle(options: JsonSerdeOptions): Serde {
  return jsonSerde(options);
}
export function defaultJsonBundle(): Serde {
  return jsonSerde();
}
export function tristateField(inner: Schema<number>): Schema<Tristate<number>> {
  return tristate(inner);
}
export function tristateShape(inner: Schema<number>): Tristate<number> {
  return tristateObject({age: inner}).parse({}).age;
}
export function replacerRoundTrip(value: unknown): string {
  return JSON.stringify(value, tristateReplacer);
}

// --- Phase 7b Observability and Logging ---
export function loggingSeam(logger: Logger, meter: Meter, tracer: Tracer): void {
  const event: LogEvent = logger.atLevel('info' satisfies LogLevel);
  event.event('test').field('k', 'v').cause(new Error('err')).emit();
  const derived = logger.withContext({global: 'val'});
  setGlobalLogger(derived);
  getGlobalLogger();
  NOOP_LOGGER.atLevel('verbose').emit();

  const c: Counter = meter.createCounter('c', {unit: '{req}'});
  c.add(1, {k: 'v'});
  const h: Histogram = meter.createHistogram('h', {description: 'd'});
  h.record(1.5);
  NOOP_METER.createCounter('c').add(1);

  const span: Span = tracer.startSpan('op');
  const scope: Scope = activateSpan(span);
  scope.close();
  const correlatedScope = activateSpanForCorrelation(span);
  correlatedScope.close();
  getActiveSpan();
  NOOP_TRACER.startSpan('op').end();
  const bundle = createInstrumentationBundle(() => tracer);
  traceOf(bundle);
  const spanCtx: SpanContext | undefined = span.spanContext?.();
  void spanCtx;

  const stepOpts: LoggingStepSettings = {
    logger,
    meter,
    severity: 'info',
    granularity: 'body' satisfies LoggingGranularity,
    previewSizeBytes: 4096,
    tracerFactory: () => tracer,
    droppedHeaderPolicy: 'mark',
  };
  const step = loggingStep(stepOpts);
  void step;
  void LOGGING_STEP_TYPE;
}

export function bridgeAdapters(pino: PinoLike, debug: DebugLike, debugFactory: DebugFactory): [Logger, Logger] {
  return [createPinoLogger(pino), createDebugLogger(debugFactory, 'custom')];
}

// Every symbol Phase 8a promotes, referenced from a consumer's own .d.ts on the declared lib with
// types: []. @dexpace/transport-shared is deliberately absent: its exports are @internal and no
// consumer is meant to import them, so only its build artifact's existence is asserted above.
export function transportErrors(failure: TransportFailureError, io: IoError): string[] {
  return [failure.name, failure.message, io.name];
}

export function transportAdapters(
  descriptor: FileBodyDescriptor,
  fileOptions: FileBodyOptions,
  fetchOptions: FetchTransportOptions,
): [Transport, FileBodyDescriptor] {
  return [fetchTransport(fetchOptions), fileBody(descriptor.path, fileOptions)];
}

export function undiciAdapter(options: UndiciTransportOptions): Transport {
  return undiciTransport(options);
}

export function rxBridge(
  stream: SseStream,
  mapper: SseMapper<number>,
  paginator: Paginator<string>,
): void {
  const _e = sseEvents$(stream);
  const _t = typedSse$(stream, mapper);
  const _i = pageItems$(paginator);
  const _p = pages$(paginator);
  void _e;
  void _t;
  void _i;
  void _p;
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
    'including every symbol the pillar-authoring surface and the Phase 6a serde seam promote, plus\n' +
    "@dexpace/codec-json's own entry point.",
);
