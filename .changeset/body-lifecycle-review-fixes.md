---
"@dexpace/core": minor
---

Body lifecycle review fixes.

Security:

- Body media types are validated as header-safe at construction (`byteArrayBody`, `stringBody`, `streamBody`, and every part rendered into a multipart body), using the same predicate as outbound header-value validation (HTTP-26). A CR/LF in a media type was previously interpolated verbatim into a multipart part header, which allowed arbitrary header injection, arbitrary part content, and a forged closing boundary while the declared content length still matched the corrupted bytes (HTTP-51).
- `StreamBody.writeTo` now refuses a chunk that would carry the body past its declared `contentLength` *before* writing it, and aborts the sink rather than closing it on any length mismatch. Overrun bytes previously reached the sink and were reported only afterwards, leaving them on the socket behind a stamped `Content-Length` (HTTP-39/BODY-10).

Correctness:

- A body write failure is no longer masked by the close that follows it. All five `Body` implementations share one writer scope that aborts on failure and never lets a close error replace the primary one (RECOV-12), so retry classification still sees the I/O failure in the cause chain (RETRY-2).
- `TypedResponse.value()` memoizes a parser that throws synchronously; it previously re-ran the handler and re-read the single-use body (HTTP-44).
- `HttpStatusError.preview()` decodes with the charset declared by the response media type, falling back to UTF-8, and never throws a `RangeError` on an unknown label (HTTP-42).
- `withRequestLogging(...).materialize()` gives the new wrapper its own tap buffer instead of aliasing the original's, so one wrapper's write can no longer rewrite another's captured preview (BODY-21).
- `withResponseLogging` treats a zero-length delegate chunk as a stream-contract violation, matching `RetentionWindow` under IO-17 (BODY-25), and `snapshot()` now starts the lazy drain the way `read()` does (BODY-22).
- `Response.close()` marks the response closed only once the release actually succeeds, memoized so concurrent closers share one cancel — the shape `BufferedSink.close()` already uses (BODY-15, HTTP-43).

Public API:

- New `FormBodyValidationError`, reported by `isBodyError`. A form field whose value cannot be rendered is now raised instead of silently dropped from the body.
- `FormUrlEncodedInput` accepts the new `FormUrlEncodedValue` (`string | number | boolean | bigint | null`); primitives render rather than vanish (HTTP-38/BODY-35).
