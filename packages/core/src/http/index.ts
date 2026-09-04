// SPDX-License-Identifier: MIT
// packages/core/src/http/index.ts
// requireField, toError, the method predicates (isIdempotent/isBodyForbidden/methodWireToken), and the
// ascii-validation predicates are deliberately NOT re-exported: HTTP-9 keeps the idempotency classification
// an internal constant rather than a public accessor, and the rest are in-package plumbing with no external
// caller yet (api-design ch10: helpers stay unexported until an outside caller genuinely needs them).
export type {Builder} from './builder.js';
export {
  DexpaceError,
  isDomainModelError,
  RequiredFieldError,
  HeaderValidationError,
  MediaTypeParseError,
  ProtocolParseError,
  UrlConstructionError,
  RequestOptionsValidationError,
  EtagParseError,
  HttpRangeValidationError,
  RequestConditionsValidationError,
  RequestBodyNotAllowedError,
} from './errors.js';
export type {Method} from './method.js';
export {Status} from './status.js';
export {Protocol} from './protocol.js';
export {MediaType} from './media-type.js';
export {Headers, HeadersBuilder, HeaderName} from './headers.js';
export {QueryParams, QueryParamsBuilder} from './query-params.js';
export {Request, RequestBuilder} from './request.js';
export {Response, ResponseBuilder} from './response.js';
export {RequestOptions, RequestOptionsBuilder} from './request-options.js';
export {ETag} from './etag.js';
export {HttpRange, type RangeKind} from './http-range.js';
export {
  RequestConditions,
  RequestConditionsBuilder,
} from './request-conditions.js';
