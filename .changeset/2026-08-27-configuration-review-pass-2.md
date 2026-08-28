---
"@dexpace/core": minor
---

Phase 7a review pass 2 (adversarial). Fourteen defects found by enumerating boundaries, failure paths, and
lifetimes against the running code. The public API surface is unchanged — `etc/core.api.md` is
byte-identical — but several of these change observable behavior, so they are recorded here.

Security and availability:

- `shouldBypassProxy` no longer compiles bypass globs to a regular expression. Translating `*` to `.*`
  produced adjacent unanchored runs, and a non-matching host then drove catastrophic backtracking: the
  operator-supplied `NO_PROXY` entry `*a*a*a*a*a*a*a*a*a*b` against a 60-character host blocked the event
  loop for 38 seconds. A two-pointer wildcard walk replaces it — 0.02ms on that case, `O(pattern × text)` at
  worst (CFG-23).
- `getBuildInfo().identityTokens` is now header-safe at its source. The runtime identity is read from
  ambient values (`process.version`, `Deno.version.deno`, `navigator.userAgent`) that were returned
  untrimmed and unvalidated, so a single non-ASCII byte in a browser `navigator.userAgent` made the default
  `clientIdentityStep` reject **every** outbound request with a `HeaderValidationError`. An unusable value
  now falls back to `unknown` (CFG-36, RECOV-33, NFR-15).
- `RETRYABLE_STATUSES` is genuinely immutable. The `ReadonlySet` type is compile-time only and
  `Object.freeze` does not seal a `Set`'s internal slots, so `(RETRYABLE_STATUSES as Set<number>).add(418)`
  succeeded and permanently rewrote the process-wide retry classifier for the whole program. `add`, `delete`,
  and `clear` now throw (CFG-35, RETRY-1).

Correctness:

- `resolveProxyOptions` honors an explicitly written default port. The WHATWG URL parser normalizes a
  special scheme's default port to the empty string, so `HTTP_PROXY=http://proxy:80` and
  `HTTPS_PROXY=https://proxy:443` — the two most common proxy configurations there are — both resolved to
  `null` and routed direct. CFG-25 bans *guessing* an absent port, not honoring one the operator wrote; a
  URL with no port at all is still rejected (CFG-25).
- `resolveProxyOptions` no longer throws a `URIError` on a literal `%` in proxy credentials. The
  percent-decode sat outside the parse `try`, and an un-encoded password containing `%` is ordinary operator
  input (CFG-24).
- The layered lookup is total against any seam. A `Record`-backed source — `process.env` included — resolves
  a key named `__proto__`, `constructor`, or `toString` through `Object.prototype`, so `getString` returned a
  *function* typed as `string | undefined` and `getInt`/`getBoolean`/`getDuration` died on a raw `TypeError`.
  A seam that throws escaped unwrapped through the same accessors. Both now fall through as "this layer
  supplies nothing" (CFG-5, CFG-6, CFG-7, CFG-11).
- `Clock.sleep` rejects a duration above `2 ** 31 - 1` ms instead of firing almost immediately. `setTimeout`
  silently clamps a larger delay to `1`, so `sleep(2 ** 31)` returned in 7ms rather than waiting 24.8 days —
  an overflowed retry backoff became no backoff at all (CFG-17).
- `Clock.sleep(0)` yields to the event loop rather than only to the microtask queue. The previous
  `Promise.resolve()` short-circuit let a zero-backoff loop spin 4.1 million times in 300ms without a pending
  `setTimeout(fn, 0)` ever running (CFG-17).
- `formatHttpDate` rejects an instant outside the four-digit-year span RFC 1123 renders. `padStart(4, '0')`
  emitted the malformed `00-1` for year −1 and `275760` for `Date`'s upper limit, neither of which survived a
  round-trip back through `parseHttpDate` (CFG-29).
- The proxy port accepts only a bare run of decimal digits. Bare `Number()` also read `0x10` as port 16,
  `1e2` as 100, `0b11` as 3, and `80.0`/`+80`, silently connecting to a port the operator never wrote
  (CFG-25).
- An IPv6 proxy address resolves to the same bare form from either configuration tier, rather than bracketed
  from the environment URL and bare from the system property (CFG-22, CFG-24).
- An empty user name means no credentials on both tiers, so a blank `https.proxyUser` no longer fabricates a
  masked `***:***@` for a proxy that has none (CFG-24).
- `randomUuid` names its missing dependency when a runtime exposes no global WebCrypto, instead of reporting
  `TypeError: Cannot read properties of undefined (reading 'getRandomValues')` (CFG-32).
- `setGlobalConfiguration` rejects a present-but-wrong value rather than only a null one, matching every
  other CFG-37 guard in the module (CFG-37).
- `Configuration.getInt` normalizes `-0` onto `0`.
