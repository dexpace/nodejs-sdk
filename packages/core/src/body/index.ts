// SPDX-License-Identifier: MIT
// packages/core/src/body/index.ts
// Internal-facing barrel for product-spec §6. Everything except the two logging tees is also promoted to
// packages/core/src/index.ts (Step 2) -- this file is the superset a future in-tree consumer (e.g. Phase
// 7's pipeline) imports from directly.
export type {Body} from './body.js';
export {
  ConsumedBodyError,
  isBodyError,
  MultipartBoundaryError,
} from './errors.js';
export {HttpStatusError, toHttpError} from './http-status-error.js';
export {materialize} from './materialize.js';
export {
  multipartBody,
  MultipartBody,
  MultipartBodyBuilder,
  type MultipartPart,
} from './multipart-body.js';
export {withRequestLogging, type LoggedBody} from './request-body-logging.js';
export {
  withResponseLogging,
  type LoggedResponseBody,
} from './response-body-logging.js';
export {
  byteArrayBody,
  ByteArrayBody,
  formUrlEncodedBody,
  FormUrlEncodedBody,
  type FormUrlEncodedInput,
  stringBody,
  StringBody,
} from './simple-bodies.js';
export {streamBody, StreamBody} from './stream-body.js';
export {TypedResponse} from './typed-response.js';
