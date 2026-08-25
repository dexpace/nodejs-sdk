---
"@dexpace/core": minor
---

Add the core Body domain interface and implementations (ByteArrayBody, StringBody, FormUrlEncodedBody, StreamBody, MultipartBody, materialize, TypedResponse, HttpStatusError, toHttpError, withRequestLogging, withResponseLogging).

`RequestBuilder.body` and `ResponseBuilder.body` narrow from `unknown` to `Body | undefined` and `ReadableStream<Uint8Array> | null` respectively — a breaking parameter-type change per `styleguide/typescript/10-api-design.md`. Resolving Phase 3b's open D1 finding (`docs/superpowers/specs/2026-07-23-nodejs-sdk-v1-roadmap-design.md`, "Open Findings — Phase 3b Validation Review"): kept as **minor** rather than major because `@dexpace/core` is still pre-1.0 (`0.0.0`), where a 0.x breaking change is conventionally released as minor (semver's own carve-out for initial development, https://semver.org/#spec-item-4). Revisit at 1.0.
