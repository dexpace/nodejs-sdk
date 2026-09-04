<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/dexpace-wordmark-dark.svg">
    <img alt="dexpace" src="docs/assets/dexpace-wordmark-light.svg" width="320">
  </picture>
</p>

<h1 align="center">Dexpace Node.js SDK</h1>

[![CI](https://github.com/dexpace/nodejs-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/dexpace/nodejs-sdk/actions/workflows/ci.yml)
[![Node >=20.3](https://img.shields.io/badge/node-%3E%3D20.3-blue.svg)](https://nodejs.org/)
[![TypeScript strict](https://img.shields.io/badge/typescript-strict-blue.svg)](https://www.typescriptlang.org/tsconfig#strict)
[![Lint: gts](https://img.shields.io/badge/lint-gts-blue.svg)](https://github.com/google/gts)
![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)

A toolkit for building Node.js HTTP client libraries. It provides immutable request and response
models, a staged policy pipeline, pluggable transports, and an authentication pillar that speaks
OAuth bearer tokens and RFC 7616 Digest. Everything is typed end to end under `strict` plus
type-aware lint, ships ESM only, and targets Node 20.3 or later.

The SDK is deliberately not an HTTP client. It defines the contracts — `Transport`, `Serde`,
`PaginationStrategy`, `Logger` — and supplies the models, policies and observability hooks that
surround them; the networking itself arrives through a transport package of your choosing. Pick the
adapter that fits your dependency budget, or write your own: the interface is two methods.

## Packages

A Bun workspace of eleven packages. Nine are published; `@dexpace/core` is a **peer** of every one of
the others, never a dependency, so a consumer can never end up with two copies of it.

| Package | Provides | Third-party dependencies |
|---|---|---|
| `@dexpace/core` | Models, pipeline, seams, resilience pillars, SSE, pagination, configuration, observability | **none** |
| `@dexpace/transport-fetch` | `fetchTransport()` over the runtime's global `fetch` | none |
| `@dexpace/transport-undici` | `undiciTransport()` — connection pools, proxies, real `close()` | `undici` |
| `@dexpace/transport-shared` | Plumbing both transports need identically; not installed directly | none |
| `@dexpace/codec-json` | `jsonSerde()` — the reference wire codec, PATCH tri-state included | none |
| `@dexpace/body-file` | `fileBody()` — a file-backed request body over `node:fs` | none |
| `@dexpace/logging-pino` | `createPinoLogger()` | `pino` (optional peer) |
| `@dexpace/logging-debug` | `createDebugLogger()` | `debug` (optional peer) |
| `@dexpace/rx` | `Observable` views of SSE and pagination | `rxjs` (peer) |

Two more are `private` and never published: `@dexpace/shrink-test`, which proves the published
bundles survive minify and tree-shake, and `@dexpace/transport-conformance`, the shared `TRANSPORT-N`
suite both transports run so they cannot drift apart.

Install the core plus whichever transport you need:

```sh
bun add @dexpace/core @dexpace/transport-fetch
```

## Quick start

### A minimal request

```typescript
import {Request} from '@dexpace/core';
import {fetchTransport} from '@dexpace/transport-fetch';

const transport = fetchTransport();

const response = await transport.send(
  Request.newBuilder().url('https://httpbin.org/get').build(),
);
try {
  console.log(response.status.code, await response.text());
} finally {
  await response.close(); // the caller owns the body, always
}
```

### A POST with a JSON body

```typescript
import {Request, serdeBody} from '@dexpace/core';
import {jsonSerde} from '@dexpace/codec-json';

const request = Request.newBuilder()
  .method('POST')
  .url('https://httpbin.org/post')
  .body(serdeBody({hello: 'world'}, jsonSerde())) // sets Content-Type: application/json
  .build();
```

### A configured pipeline

`standardResilience()` returns a `Runtime` pre-wired with all four pillars in the order `AUTH-27`
requires — redirect wraps retry wraps auth — so a retry re-resolves credentials and a redirect hop
re-stamps them. Every slot is optional; an omitted one takes that pillar's own defaults.

```typescript
import {
  createAuthDescriptor,
  createAuthRequirement,
  createBearerToken,
  standardResilience,
} from '@dexpace/core';
import {undiciTransport} from '@dexpace/transport-undici';

declare function mintToken(): Promise<string>;

const client = standardResilience(undiciTransport({agentOptions: {connections: 32}}), {
  retry: {settings: {maxAttempts: 5, totalTimeoutMs: 30_000}},
  redirect: {maxHops: 3},
  auth: {
    credentials: {
      bearer: {provider: async () => createBearerToken(await mintToken()), marginMs: 60_000},
    },
    tiers: {client: createAuthDescriptor([createAuthRequirement('OAUTH2')])},
  },
});
```

`PipelineBuilder` enforces stage ordering and the one-step-per-pillar rule, and supports surgical
edits anchored on a step's `type` symbol: `insertBefore`, `insertAfter`, `replace`, `remove`.
`PipelineBuilder.seedFrom(runtime, 'flatten' | 'nest')` layers your own steps onto the preset.

### Streaming and replayable bodies

```typescript
import {byteArrayBody, materialize, streamBody, stringBody} from '@dexpace/core';
import {fileBody} from '@dexpace/body-file';

declare const stream: ReadableStream<Uint8Array>;

byteArrayBody(new Uint8Array([1, 2, 3])); // replayable
stringBody('{"hello":"world"}', 'application/json'); // replayable
fileBody('upload.bin', {start: 0, count: 4096}); // replayable; fresh handle per send
const once = streamBody(stream); // single-use: a retry cannot re-send it

const many = await materialize(once); // buffer it once, deliberately, to make it retryable
```

Buffering an arbitrarily large upload to make it retryable is a decision for the caller who knows how
large it is, not for the retry engine — so a retryable body arrives at the retry pillar already
retryable.

## Architecture

A request flows down through ordered `Step`s and back up through their post-processing. The terminal
stage hands it to a `Transport`.

```
caller → Runtime ──┬─ PRE_REDIRECT · REDIRECT · POST_REDIRECT
                   ├─ PRE_RETRY    · RETRY    · POST_RETRY
                   ├─ PRE_AUTH     · AUTH     · POST_AUTH
                   ├─ PRE_LOGGING  · LOGGING  · POST_LOGGING
                   ├─ PRE_SERDE    · SERDE    · POST_SERDE
                   └─ SEND → Transport → wire
```

Sixteen stages in `STAGE_ORDER`. Five of them — `REDIRECT`, `RETRY`, `AUTH`, `LOGGING`, `SERDE` — are
**pillars**: each admits exactly one step and raises on a second. The `PRE_`/`POST_` stages around
them stack, and are the user-extensible slots.

`Runtime` implements `Transport`, so a pipeline is substitutable wherever a transport is — which is
what makes nesting, `seedFrom`, and driving a `Paginator` over a full pipeline work.

Bottom-up, the layers are:

1. **Bodies.** A request `Body` is a producer: `writeTo(sink)` emits on demand, `replayable` decides
   whether a retry may re-send. A response body is a `ReadableStream` the **caller** owns and closes.
2. **Models.** `Request`, `Response`, `Headers`, `QueryParams`, `RequestOptions` and
   `RequestConditions` are frozen at construction and reachable only through a builder, so validation
   cannot be routed around and behaviour is identical under every transport.
3. **Context.** `DispatchContext` promotes to `RequestContext` then `ExchangeContext`, carrying one
   `InstrumentationBundle` throughout; propagation is `AsyncLocalStorage`-based.
4. **Pipeline.** `Step`, `Next`, `StepContext`, `StepDescriptor`, `PipelineBuilder`, `Runtime`.
5. **Transport.** `send()` and `close()`. That is the whole contract.

## Inside `@dexpace/core`

| Module | Surface |
|---|---|
| `http/` | `Request`, `Response`, `Headers`, `HeaderName`, `Status`, `Protocol`, `MediaType`, `ETag`, `HttpRange`, `QueryParams`, `RequestOptions`, `RequestConditions` |
| `body/` | `byteArrayBody`, `stringBody`, `formUrlEncodedBody`, `multipartBody`, `streamBody`, `serdeBody`, `materialize`, `TypedResponse`, `HttpStatusError`, `toHttpError` |
| `pipeline/` | `Stage`, `STAGE_ORDER`, `PILLAR_STAGES`, `Step`, `Next`, `StepContext`, `StepDescriptor`, `PipelineBuilder`, `Runtime` |
| `retry/` | `retryStep`, `RetrySettings`, `BackoffSettings` — exponential backoff with jitter, `Retry-After` awareness, injectable `Clock`/`random` |
| `redirect/` | `redirectStep`, `RedirectSettings`, `RedirectPredicate` — loop detection, hop cap, downgrade guard, credential stripping |
| `auth/` | `authStep`, `standardResilience`, `createAuthDescriptor`, `createAuthRequirement`, `ApiKeyCredential`, `NameKeyCredential`, `BearerToken`, RFC 7235 challenges, RFC 7616 Digest |
| `serde/` | `Serde`, `Serializer`, `Deserializer`, `Schema`, `Tristate`, `decodeResponse`, `decodeSuccessResponse` |
| `sse/` | `sseStreamFrom`, `SseStream`, `SseEvent`, `typedSseStream` — WHATWG-compliant, bounded line buffer |
| `pagination/` | `Paginator`, `Page`, `PaginationStrategy`, `cursorStrategy`, `pageNumberStrategy`, `linkHeaderStrategy`, `paginateWithFetchers` |
| `config/` | `Configuration`, `ConfigurationBuilder`, `Clock`, `ProxyOptions`, `getBuildInfo`, HTTP-date parsing |
| `observability/` | `Logger`, `createLogger`, `LogEvent`, `Tracer`, `Span`, `Meter`, `loggingStep`, URL redaction, no-op singletons |
| `context/` | `DispatchContext` → `RequestContext` → `ExchangeContext`, `InstrumentationBundle` |
| `seams/` | `Transport`, `Serde`, `OperationDescriptor`, `buildRequest`, `composeSignal`, `isTimeoutSignal` |

## Highlights

- **Zero runtime dependencies, and it is a gate.** `@dexpace/core` takes none, and
  `bun run verify:seam-1` asserts that for **every** package in the workspace plus the
  `@dexpace/core`-as-peer rule that guards the dual-package hazard.
- **Immutable models, no public constructors.** Builders only; the emitted `.d.ts` declares each
  constructor `private`, so a consumer cannot construct around `build()`'s validation. Deriving
  deep-copies every collection rather than aliasing.
- **Pluggable everything, registered nothing.** `Transport`, `Serde`, `Schema`,
  `PaginationStrategy`, `Logger`, `Tracer`, `Meter` and `Clock` are duck-typed — a conforming object
  is a valid implementation, with no registry, no discovery and no install step.
- **Retry done right.** Exponential backoff with jitter, server pacing hints (`Retry-After`,
  `X-RateLimit-Reset`) in a fixed precedence, an opt-in total-timeout budget, and deterministic tests
  through an injectable `Clock`.
- **Redirects done right.** Loop detection, hop cap, `Authorization` stripped across origins,
  HTTPS→HTTP downgrade refused by default, and the transport pinned to never follow a hop itself, so
  the pipeline is the single redirect authority.
- **Real auth.** OAuth bearer with serialized concurrent refresh, an RFC 7235 `WWW-Authenticate`
  parser, RFC 7616 Digest (MD5, MD5-sess, SHA-256, SHA-256-sess), Basic and key credential — with
  credentials refused over plaintext and redacted in every `toString` and inspect path.
- **PATCH tri-state.** `Tristate<T>` distinguishes absent, null and present, so `{}` and
  `{"x": null}` stop being the same wire message. Wired into `@dexpace/codec-json` by default.
- **Server-Sent Events and pagination.** A WHATWG-compliant SSE parser with a bounded line buffer and
  no reconnect path in core (gate-enforced), and a `Paginator` that walks item-by-item or page-by-page
  over pluggable strategies.
- **Observability that costs nothing when off.** `NOOP_LOGGER`, `NOOP_TRACER` and `NOOP_METER` are
  the defaults; a suppressed event never builds its field map.
- **Proven against Node, not just Bun.** A separate conformance suite runs the built artifact under
  `node --test`, as a matrix over the declared floor and current LTS, because Bun's Web Streams and
  `AbortSignal` are an independent implementation.

## Development

A [Bun](https://bun.sh) workspace, pinned by `.bun-version` (1.3.14). One install provisions every
package.

```bash
git clone https://github.com/dexpace/nodejs-sdk.git
cd nodejs-sdk
bun install --frozen-lockfile
```

```bash
bun run build          # every package's dist/
bun run typecheck      # tsc --noEmit, per package
bun run lint           # gts — formatting AND type-aware rules, both fatal
bun run test           # both Bun test trees, one coverage report, 80% line floor
bun run test:node      # the built artifact under node --test
bun run api            # every committed etc/*.api.md matches
```

Twenty named CI steps across two jobs, every one blocking
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)). Run all of them locally before claiming
work is done:

```bash
node .claude/skills/ci-preflight/run-ci.mjs --clean
```

`--clean` sweeps every `dist/` and `*.tsbuildinfo` first, so the run starts from the tree CI checks
out rather than a warm one, and pins every step to `.bun-version`'s Bun. Both matter: a transport
suite has passed on one Bun release and failed three ways on the pinned one.

## Conventions

The full contract is in [`CLAUDE.md`](CLAUDE.md); the documentation map is
[`docs/README.md`](docs/README.md). The short version:

- **Spec-driven, not feature-driven.** [`docs/product-spec/`](docs/product-spec/) is normative and
  numbered; the code exists to satisfy it. Before implementing anything, find the requirement IDs.
- **ESM only, `NodeNext`.** Relative imports carry `.js` even in `.ts` source;
  `verbatimModuleSyntax` is on. No enums, no namespaces, no parameter properties.
- **`#private` fields, private constructors, `Object.freeze(this)`.** Every domain model follows one
  construction pattern; deviating breaks invariants no tool catches.
- **Typed errors only.** Everything descends from `DexpaceError`; wrap-and-rethrow always passes
  `{cause}`.
- **Lint is type-aware and strict.** 70-line function cap, `max-depth` 3, `max-params` 3, explicit
  return types on exported functions. Formatting is an error, not a warning. Every
  `eslint-disable` must carry a stated reason.
- **Every gap is recorded.** A deferral goes in [`docs/deferred-items.md`](docs/deferred-items.md),
  which drops the row once the work lands, so the table states what is still outstanding and nothing
  else. A finding goes in [`docs/open-items.md`](docs/open-items.md), and a deliberate divergence in
  the deviation ledger. Silent gaps are the failure mode this project is structured to prevent.

As-built documentation — how the packages compose, and worked examples across a package boundary —
is [`docs/sdk-documentation/`](docs/sdk-documentation/).

## Releases

Releases start from `main` only. The workflow is
[`.github/workflows/release.yml`](.github/workflows/release.yml). It runs on each push to `main`.
It reads the pending changesets and opens a "Version Packages" pull request. When that pull request
merges, the workflow publishes the packages.

The workflow does not run on `mvp` or on any other branch. Work on those branches is not released.
Changesets written there wait until the branch merges into `main`.

Each package is at version `0.0.0`. The first release starts from that version.

Publishing is blocked at this time. The block is deliberate. Three conditions must be true before
the first publish can succeed:

1. The repository must have an `NPM_TOKEN` secret. Without it, the workflow opens the pull request
   but does not publish.
2. The maintainers must decide the access level of the `@dexpace` scope.
   [`.changeset/config.json`](.changeset/config.json) sets `"access": "restricted"`. Restricted
   packages are private. npm does not attach provenance to a private package. The workflow sets
   `NPM_CONFIG_PROVENANCE` for `NFR-16`, so a publish with the current setting fails. To publish
   with provenance, set the access to `public`. To stay private, remove the provenance setting and
   record `NFR-16` as a deviation.
3. The source repository must be public. npm issues provenance attestations for public source only.

[`docs/deferred-items.md`](docs/deferred-items.md) records all three under `NFR-16`.

The sibling repositories do not share one answer yet. `dexpace/python-sdk` publishes to PyPI with
trusted publishing and PEP 740 attestations; PyPI has no private tier, so those packages are public
by construction. `dexpace/dexpace-react` is `UNLICENSED`, sets `"access": "restricted"`, and its
release policy names `npm publish --provenance`, which is the same conflict as this repository.
This SDK is MIT-licensed, like the Python SDK. Until the maintainers decide, this repository keeps
the current settings and stays unpublished.
