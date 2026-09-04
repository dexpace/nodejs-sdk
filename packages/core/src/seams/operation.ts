// SPDX-License-Identifier: MIT
// packages/core/src/seams/operation.ts
import type {Body} from '../body/body.js';
import {Request} from '../http/request.js';
import type {Headers} from '../http/headers.js';
import type {QueryParams} from '../http/query-params.js';
import type {Method} from '../http/method.js';
import {UrlConstructionError, DexpaceError} from '../http/errors.js';
import {encodeRfc3986Component} from '../http/rfc3986.js';

/**
 * Thrown when `buildRequest()` cannot assemble a request from its descriptor: a `{name}`
 * placeholder in `pathTemplate` has no value in `pathParams`, or a supplied value is a dot segment
 * (`.`/`..`) that the WHATWG URL parser would normalize into a path rewrite instead of keeping as
 * one literal segment.
 *
 * @public
 */
export class OperationAssemblyError extends DexpaceError {
  /** The path parameter the failure is about — a structured field so log aggregators need not parse the message. */
  readonly parameterName: string;

  /**
   * @param message - the human-readable failure description.
   * @param parameterName - the name of the offending path parameter.
   */
  constructor(message: string, parameterName: string) {
    super(message);
    this.parameterName = parameterName;
  }
}

/**
 * The operation-input projection SEAM-26 requires: a method and path template are always required,
 * the four remaining projections default to empty when omitted. `?: T | undefined` (not a bare
 * `?: T`) is required under `exactOptionalPropertyTypes` so a generator that spreads a partial
 * object or assigns every field including the empty ones can pass `undefined` explicitly without a
 * type error.
 *
 * @public
 */
export interface OperationDescriptor {
  /** The HTTP method the operation is issued with. Always required (SEAM-26). */
  readonly method: Method;

  /**
   * The path to project onto the base URL, with `{name}` placeholders for path parameters. Always
   * required (SEAM-26); an empty string leaves the base URL's path untouched (SEAM-27).
   */
  readonly pathTemplate: string;

  /**
   * Values for `pathTemplate`'s `{name}` placeholders. Every placeholder must have a value here;
   * each value is percent-encoded as a single path segment, so a value containing `/` cannot inject
   * an extra segment (SEAM-27). Defaults to empty.
   */
  readonly pathParams?: Readonly<Record<string, string>> | undefined;

  /**
   * The operation's query parameters, appended after any query the base URL already carries
   * (SEAM-27). Defaults to empty.
   */
  readonly query?: QueryParams | undefined;

  /** The operation's headers, carried onto the assembled request as-is. Defaults to empty. */
  readonly headers?: Headers | undefined;

  /**
   * The operation's body. Carried, not encoded — serialization is a separate seam's concern
   * (SEAM-26). Defaults to absent.
   */
  readonly body?: Body | undefined;
}

const PATH_PARAM_RE = /\{([^{}]+)\}/g;

function parseBaseUrl(baseUrl: string | URL): URL {
  if (baseUrl instanceof URL) return new URL(baseUrl.href);
  try {
    return new URL(baseUrl);
  } catch (e: unknown) {
    throw new UrlConstructionError(
      `malformed or non-absolute base URL: ${baseUrl}`,
      {
        cause: e,
      },
    );
  }
}

function normalizeBaseUrl(baseUrl: string | URL): URL {
  const parsed = parseBaseUrl(baseUrl);
  if (parsed.hash !== '') {
    throw new UrlConstructionError(
      `base URL must not include a fragment: ${parsed.href}`,
    );
  }
  return parsed;
}

function substitutePathParams(
  template: string,
  pathParams: Readonly<Record<string, string>> | undefined,
): string {
  return template.replace(PATH_PARAM_RE, (_match, name: string) => {
    const value = pathParams?.[name];
    if (value === undefined) {
      throw new OperationAssemblyError(
        `missing value for path parameter "${name}"`,
        name,
      );
    }
    // "." and ".." are RFC 3986 unreserved, so they survive encoding — and the WHATWG URL parser
    // treats "%2E" the same as "." during dot-segment normalization, so percent-encoding cannot
    // keep them literal either. Rejection is the only lossless option: silently forwarding ".."
    // would let a path value rewrite the path.
    if (value === '.' || value === '..') {
      throw new OperationAssemblyError(
        `path parameter "${name}" must not be a dot segment ("." or "..")`,
        name,
      );
    }
    return encodeRfc3986Component(value);
  });
}

function composePath(basePath: string, substitutedTemplate: string): string {
  if (substitutedTemplate === '') return basePath;
  const normalizedTemplate = substitutedTemplate.startsWith('/')
    ? substitutedTemplate
    : `/${substitutedTemplate}`;
  const trimmedBase = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  return `${trimmedBase}${normalizedTemplate}`;
}

function composeQuery(
  baseSearch: string,
  operationQuery: QueryParams | undefined,
): string {
  const rawBaseQuery = baseSearch.startsWith('?')
    ? baseSearch.slice(1)
    : baseSearch;
  // SEAM-27: the base query's dangling separator is dropped before the operation query is appended.
  const baseQueryPart = rawBaseQuery.replace(/&+$/, '');
  const operationQueryPart = operationQuery?.encode() ?? '';
  return [baseQueryPart, operationQueryPart]
    .filter(part => part !== '')
    .join('&');
}

/**
 * Projects an {@link OperationDescriptor} onto a base URL, producing a well-formed {@link Request}.
 * Path placeholders are substituted through `encodeRfc3986Component`, so a placeholder value
 * containing `/` is encoded (`%2F`), never split into an extra path segment (SEAM-27). Dot-segment
 * values (`.`, `..`) are rejected outright — the WHATWG URL parser treats `%2E` the same as `.`, so
 * no encoding can keep them literal.
 *
 * @param baseUrl - the absolute base URL to project the operation onto.
 * @param operation - the operation to assemble into a request.
 * @returns the assembled request.
 * @throws {@link OperationAssemblyError} when a `{name}` placeholder has no value in `pathParams`,
 * or a supplied value is a dot segment (`.`/`..`) — fix the descriptor; no request was assembled.
 * @throws {@link UrlConstructionError} when `baseUrl` is malformed, non-absolute, or carries a
 * fragment — supply a clean absolute base URL.
 * @throws {@link RequestBodyNotAllowedError} when the descriptor pairs a body with GET, HEAD, TRACE
 * or CONNECT (HTTP-7). Assembly ends at `Request.Builder.build()`, so that builder's validation is
 * this function's validation.
 *
 * @public
 */
export function buildRequest(
  baseUrl: string | URL,
  operation: OperationDescriptor,
): Request {
  const base = normalizeBaseUrl(baseUrl);
  const substitutedPath = substitutePathParams(
    operation.pathTemplate,
    operation.pathParams,
  );

  const target = new URL(base.href);
  target.pathname = composePath(base.pathname, substitutedPath);
  target.search = composeQuery(base.search, operation.query);

  const requestBuilder = Request.newBuilder()
    .method(operation.method)
    .url(target);
  if (operation.headers !== undefined)
    requestBuilder.headers(operation.headers);
  if (operation.body !== undefined) requestBuilder.body(operation.body);
  return requestBuilder.build();
}
