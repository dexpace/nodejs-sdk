// SPDX-License-Identifier: MIT
// packages/core/src/config/build-info.ts
import {SDK_VERSION} from '../generated/version.js';

/**
 * The build/runtime identity descriptor (CFG-36): the SDK's own version, the host runtime it is
 * executing on, and the ordered token list a `User-Agent`-style header composes from. Every field is
 * non-blank -- an undetectable value reads `unknown`, never an empty string.
 *
 * @public
 */
export interface BuildInfo {
  /** This SDK's own published version, compiled in at build time; `'unknown'` if it was not. */
  readonly sdkVersion: string;
  /** The host runtime, e.g. `'node/20.11.0'`; `'unknown'` when undetectable. */
  readonly runtimeIdentity: string;
  /** `[sdkToken, runtimeToken]`, in that order; every entry is non-blank. */
  readonly identityTokens: readonly string[];
}

/**
 * The shapes this module feature-detects on `globalThis`; none of them is imported, so the same
 * source compiles and runs on every runtime in core's floor.
 *
 * @internal
 */
export interface RuntimeHost {
  readonly process?: {readonly version?: unknown};
  readonly Deno?: {readonly version?: {readonly deno?: unknown}};
  readonly navigator?: {readonly userAgent?: unknown};
}

/**
 * Printable ASCII plus HTAB -- the outbound header value grammar's character class, restated here.
 *
 * Deliberately *not* `hasForbiddenOutboundByte` from `http/ascii-validation.js`. `config/`'s
 * outbound edges are already a live concern (`docs/open-items.md` K11), and adding a second one to
 * reuse a four-line predicate is the wrong trade. `docs/open-items.md` K18 owns the duplication and
 * names this as one of the call sites a consolidation would fold in.
 */
function isHeaderSafe(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code !== 0x09 && (code < 0x20 || code > 0x7e)) return false;
  }
  return true;
}

/**
 * A detected value fit to become an identity token: trimmed, non-blank, and header-safe.
 *
 * Both halves earn their place (CFG-36, RECOV-33, NFR-15). The value is ambient -- `process.version`,
 * `Deno.version.deno`, `navigator.userAgent` -- and nothing guarantees it is ASCII or tidy. It used
 * to be returned *untrimmed* despite the blank test trimming, so `'  v20.0.0  '` became
 * `node/  v20.0.0  ` and the `^v` strip silently missed; and it was never validated, so a
 * `navigator.userAgent` carrying one non-ASCII byte made the default `clientIdentityStep` reject
 * every outbound request with a `HeaderValidationError`. An unusable value is undetectable, not
 * fatal: the caller falls back to `unknown`, exactly as it does for an absent one.
 */
function toUsableToken(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed !== '' && isHeaderSafe(trimmed) ? trimmed : null;
}

/**
 * Feature-detected, never throwing (CFG-36). Node and Bun report through `process`, Deno through
 * `Deno.version`, browsers and Workers through `navigator.userAgent`; anything else falls back to
 * the literal `unknown`, matching CFG-36's own "falls back to a non-blank `unknown`" wording.
 *
 * Takes the host explicitly rather than reading `globalThis` inline: the branches this phase cannot
 * execute on its own runners are then reachable from a test without deleting a global, which no test
 * may do (`docs/knowledge/harvested/testing.md:50` -- tests must survive parallel execution).
 *
 * @param host - the ambient global object to interrogate.
 * @returns a non-blank runtime identity token.
 *
 * @internal
 */
export function detectRuntimeIdentity(host: RuntimeHost): string {
  const nodeVersion = toUsableToken(host.process?.version);
  // A `process.version` of exactly `'v'` strips to nothing; `node/` with no version behind it is a
  // worse answer than saying so, and falling through gives the remaining probes their chance.
  const stripped = nodeVersion?.replace(/^v/u, '') ?? '';
  if (stripped !== '') return `node/${stripped}`;

  const denoVersion = toUsableToken(host.Deno?.version?.deno);
  if (denoVersion !== null) return `deno/${denoVersion}`;

  const userAgent = toUsableToken(host.navigator?.userAgent);
  if (userAgent !== null) return userAgent;

  return 'unknown';
}

function resolveBuildInfo(): BuildInfo {
  const sdkVersion = toUsableToken(SDK_VERSION) ?? 'unknown';
  const runtimeIdentity = detectRuntimeIdentity(globalThis);
  return Object.freeze({
    sdkVersion,
    runtimeIdentity,
    identityTokens: Object.freeze([
      `dexpace-sdk/${sdkVersion}`,
      runtimeIdentity,
    ]),
  });
}

/**
 * Module-level mutable state, which `docs/knowledge/harvested/variables-and-declarations.md:22` bans outright.
 * Deliberate: CFG-36's descriptor is resolved once per process, and the alternative -- re-running the
 * feature detection per request -- is the cost the memo exists to avoid. Safe against the rule's
 * stated hazard because `resolveBuildInfo` is deterministic within a process, so no test can observe
 * a different value depending on which test ran first. There is deliberately no reset hook: nothing
 * needs one, and adding one would publish a way to make the descriptor lie.
 */
let cachedBuildInfo: BuildInfo | undefined;

/**
 * The process-wide build/runtime descriptor (CFG-36), resolved on first access and cached thereafter
 * so the runtime detection runs once rather than per request.
 *
 * @returns the frozen descriptor; the same instance on every call.
 *
 * @public
 */
export function getBuildInfo(): BuildInfo {
  cachedBuildInfo ??= resolveBuildInfo();
  return cachedBuildInfo;
}
