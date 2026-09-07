// SPDX-License-Identifier: MIT
// packages/core/src/config/client-identity-step.ts
import type {Headers} from '../http/headers.js';
import type {Request} from '../http/request.js';
import type {StepDescriptor} from '../pipeline/step.js';
import {getBuildInfo} from './build-info.js';

/**
 * How {@link clientIdentityStep} composes its tokens into the target header (RECOV-33).
 *
 * @public
 */
export interface ClientIdentitySettings {
  /**
   * The header to write.
   *
   * @defaultValue `'User-Agent'`
   */
  readonly headerName?: string | undefined;

  /**
   * The tokens to compose, joined with single spaces.
   *
   * @defaultValue `getBuildInfo().identityTokens`
   */
  readonly tokens?: readonly string[] | undefined;

  /**
   * `'append'` composes after the first existing value; `'replace'` overwrites every existing value.
   *
   * @defaultValue `'append'`
   */
  readonly mode?: 'append' | 'replace' | undefined;
}

/** Identity for pipeline anchoring; a fresh symbol per module, not per call. */
const CLIENT_IDENTITY_STEP_TYPE = Symbol('dexpace.client-identity');

/**
 * RECOV-33's Append composition: the token line joins onto the FIRST existing value, and an empty
 * first value counts as absent so no leading space is emitted.
 *
 * Its own function despite having one caller: the empty-first-value rule is RECOV-33's, not an
 * implementation detail of {@link composeHeaders}, and it earns a name and this note rather than an
 * unexplained ternary inside the write.
 */
function composeFirstValue(existingFirst: string, tokenLine: string): string {
  return existingFirst === '' ? tokenLine : `${existingFirst} ${tokenLine}`;
}

/**
 * The header name and mode {@link composeHeaders} needs, after {@link clientIdentityStep} has applied
 * its defaults. One object rather than two more parameters, so `composeHeaders` stays inside the
 * three-parameter cap (`docs/knowledge/harvested/function-design.md:22`).
 */
interface ResolvedComposition {
  readonly headerName: string;
  readonly mode: 'append' | 'replace';
}

/**
 * Writes the composed header, preserving every pre-existing value RECOV-33 says must survive.
 *
 * `HeadersBuilder` offers only `set` (replace the whole value list) and `add` (append one more), so
 * Append mode rewrites the list explicitly: `set` the composed first value -- which keeps the
 * header's position in insertion order, unlike a remove-then-re-add -- then `add` each remaining
 * original value back in order. Replace mode legitimately overwrites everything, so a plain `set`
 * is the whole of it.
 */
function composeHeaders(
  headers: Headers,
  composition: ResolvedComposition,
  tokenLine: string,
): Headers {
  const {headerName, mode} = composition;
  const builder = headers.newBuilder();
  const existing = mode === 'replace' ? [] : headers.getAll(headerName);
  if (existing.length === 0) return builder.set(headerName, tokenLine).build();

  // The `''` fallback is unreachable -- the guard above returned for an empty list -- and exists
  // only because `noUncheckedIndexedAccess` cannot see that. The *reachable* empty-string case is a
  // header whose first value really is empty, which `composeFirstValue` owns.
  builder.set(headerName, composeFirstValue(existing[0] ?? '', tokenLine));
  for (const value of existing.slice(1)) builder.add(headerName, value);
  return builder.build();
}

/**
 * Builds the client-identity pipeline step (RECOV-33), which stamps the SDK's build and runtime
 * identity onto every outbound request and so closes NFR-15's "report the real version" clause.
 *
 * Append mode (the default) joins the tokens with single spaces and appends them after the first
 * existing header value, preserving every other pre-existing value untouched, or sets them as the
 * sole value when the header is absent. Replace mode overwrites every existing value. A token list
 * that is empty or joins to a blank line makes the step a no-op: it never emits a blank or
 * whitespace-only header.
 *
 * Not a pillar step. It occupies `PRE_REDIRECT`, the outermost user-extensible slot, so it runs once
 * per top-level call rather than once per redirect or retry attempt, and it is not installed by any
 * preset -- a caller adds it to their own pipeline.
 *
 * @param settings - header name, tokens, and composition mode; every field is optional.
 * @returns the step descriptor to install.
 * @throws HeaderValidationError -- as a rejected promise -- when the composed value or the header
 *   name is not legal on the outbound path.
 *
 * @public
 */
export function clientIdentityStep(
  settings: ClientIdentitySettings = {},
): StepDescriptor {
  const headerName = settings.headerName ?? 'User-Agent';
  const mode = settings.mode ?? 'append';
  // Copied and frozen here, never aliased: a caller that keeps its own array must not be able to
  // rewrite what an already-installed step emits (the same defensive-copy discipline HTTP-3 puts on
  // every model builder).
  const tokens =
    settings.tokens === undefined
      ? undefined
      : Object.freeze([...settings.tokens]);

  return {
    type: CLIENT_IDENTITY_STEP_TYPE,
    stage: 'PRE_REDIRECT',
    fn: async (request: Request, ctx) => {
      // The default resolves per invocation rather than per install, so a step built before anything
      // has touched `getBuildInfo()` still stamps the resolved descriptor.
      const tokenLine = (tokens ?? getBuildInfo().identityTokens)
        .join(' ')
        .trim();
      if (tokenLine === '') return ctx.next(request);

      const headers = composeHeaders(
        request.headers,
        {headerName, mode},
        tokenLine,
      );
      return ctx.next(request.newBuilder().headers(headers).build());
    },
  };
}
