---
"@dexpace/core": minor
---

Add the configuration subsystem and the shared platform primitives (Phase 7a): the layered `Configuration` model with its `ConfigurationBuilder`, substitutable env/property seams, never-throw typed accessors, copy-on-write `derive`, the process-wide global slot, and the well-known `CFG_KEY_*` constants; the injectable `Clock` seam and `defaultClock`; RFC 1123 `formatHttpDate`/`parseHttpDate`; the shared `isRetryableStatus`/`RETRYABLE_STATUSES` classifier; `randomUuid`; the `ProxyOptions` model with `createProxyOptions`, `formatProxyOptions`, `shouldBypassProxy`, and `resolveProxyOptions`; and the `BuildInfo` descriptor behind `getBuildInfo`.

`@dexpace/core`'s own version is now compiled in at build time by `scripts/gen-version.mjs`, which the package's `prebuild` step runs — so a runtime-emitted identifier reports the real version rather than an `unknown` placeholder, with no runtime `package.json` read on any runtime.
