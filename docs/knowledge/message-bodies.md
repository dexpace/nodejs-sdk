# message-bodies

## Rules
- Both transport seams MUST be closeable, and close MUST be idempotent, ownership-aware (only resources the transport itself created are released, and a caller-supplied client/executor is never touched), and interrupt-safe; a lightweight transport MAY have a no-op close (SEAM-14).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:43-43` · high · sha:0adae2d6a47f</sub>
- An async-runtime adapter that owns an executor MUST implement close as an idempotent, ownership-aware release where only the first close shuts the owned executor and emits the lifecycle event (SEAM-25).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:44-44` · high · sha:0adae2d6a47f</sub>
- Closing an async-runtime adapter MUST NOT be required to cancel in-flight requests — a graceful drain is acceptable — and an adapter built over a caller-supplied executor MUST NOT shut it down (SEAM-25).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:44-44` · high · sha:0adae2d6a47f</sub>
- Async-runtime adapters that hand work to another thread SHOULD propagate the ambient logging/diagnostic context across the thread handoff, and SHOULD map cancellation bidirectionally per that ecosystem's idiom (SEAM-24).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:45-45` · high · sha:0adae2d6a47f</sub>
- A request body MUST produce bytes on demand via a single write-to-sink operation, report its media type (nullable) and content length (with -1 meaning unknown), and expose a boolean replayability property defaulting to false, meaning single-use (HTTP-36 / BODY-1).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:7-7` · high · sha:c2bf15dc8a06</sub>
- Replayability MUST be true only when writing a body more than once yields byte-for-byte identical output (HTTP-36 / BODY-1).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:7-7` · high · sha:c2bf15dc8a06</sub>
- A composite body such as multipart MUST report replayable if and only if every part is replayable, and its declared content length MUST collapse to unknown if any part's length is unknown (BODY-2).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:8-8` · high · sha:c2bf15dc8a06</sub>
- A multipart body SHOULD derive its declared length and its written bytes from one shared framing routine so length cannot drift from bytes written, generate a spec-valid random boundary, and reject a caller boundary violating the RFC 2046 grammar (HTTP-51).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:8-8` · high · sha:c2bf15dc8a06</sub>
- A multipart body MUST quote/escape part-header parameter values so CR/LF or a quote cannot break the framing (HTTP-51).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:8-8` · high · sha:c2bf15dc8a06</sub>
- A materialize-once operation MUST return the same body unchanged when already replayable, and otherwise drain the body's write output exactly once into an in-memory buffer and return a replayable buffer-backed body, after which the original MUST be treated as consumed (BODY-3 / HTTP-37).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:9-9` · high · sha:c2bf15dc8a06</sub>
- A single-use body MUST fail loudly on a second write, never silently emitting zero bytes, and the consume-once guard MUST be race-safe so that under concurrent writes at most one proceeds and the losers observe a clear error (BODY-3 / HTTP-37).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:9-9` · high · sha:c2bf15dc8a06</sub>
- A single-use body that owns a closeable source MUST release that source as part of its single write, so skipping materialization does not leak it (BODY-8).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:10-10` · high · sha:c2bf15dc8a06</sub>
- A port MUST decide its stream-ownership rule deliberately rather than assume every single-use body closes its input (BODY-8).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:10-10` · high · sha:c2bf15dc8a06</sub>
- A stream-backed body of known length SHOULD be treated as replayable when and only when the stream supports mark/reset and the length fits the platform's maximum single-array bound; otherwise it MUST be single-use (BODY-9).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:11-11` · high · sha:c2bf15dc8a06</sub>
- When a stream-backed body is replayable, each write after the first MUST rewind before reading, with a race-safe rewind guaranteeing at most one reset between any two writes (BODY-9).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:11-11` · high · sha:c2bf15dc8a06</sub>
- An exact-length copy from a source MUST write precisely the declared count; a premature end of stream MUST raise an end-of-file error naming delivered-of-total (HTTP-39 / BODY-10).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:12-12` · high · sha:c2bf15dc8a06</sub>
- A zero-length read for a positive request during an exact-length copy MUST be treated as a stream-contract violation, never as an infinite spin or EOF, and a declared length of 0 MUST be a legitimate empty write (HTTP-39 / BODY-10).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:12-12` · high · sha:c2bf15dc8a06</sub>
- A file-backed body MUST be replayable, open a fresh file handle per write, and validate fail-fast at construction that the file exists, is a regular file, the offset is non-negative and within the size captured at construction, and offset+count does not exceed that size (HTTP-40 / BODY-11).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:13-13` · high · sha:c2bf15dc8a06</sub>
- A file transfer MUST detect a short write and raise an error naming transferred-of-total (BODY-13).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:13-13` · high · sha:c2bf15dc8a06</sub>
- A file body SHOULD stream via the platform's most efficient file-to-sink transfer and be recognizable by type so transports can dispatch a true zero-copy kernel path (BODY-12).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:13-13` · high · sha:c2bf15dc8a06</sub>
- Body factories MUST classify replayability by source: byte-array, string, buffer, file, and serialized bodies are replayable, and a one-shot stream is single-use unless mark/reset applies (HTTP-38 / BODY-35).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:14-14` · high · sha:c2bf15dc8a06</sub>
- A form-urlencoded body MUST be replayable and use x-www-form-urlencoded encoding, where "+" represents space, distinct from RFC 3986 query encoding (HTTP-38 / BODY-35).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:14-14` · high · sha:c2bf15dc8a06</sub>
- A body's declared content length MUST report the exact count when known and the -1 sentinel otherwise, and ports MUST NOT assume a known length is always present (HTTP-38 / BODY-35).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:14-14` · high · sha:c2bf15dc8a06</sub>
- A response body MUST be single-use — its read handle is obtained once and, once consumed, the bytes are gone; requesting the handle repeatedly returns the same underlying handle, not a replay (HTTP-41 / BODY-14).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:23-23` · high · sha:c2bf15dc8a06</sub>
- Repeatable/non-destructive access to a response body MUST require an explicit buffering wrapper (HTTP-41 / BODY-14).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:23-23` · high · sha:c2bf15dc8a06</sub>
- Closing a response body MUST release the underlying transport connection, MUST be idempotent, and MUST NOT assume the body was read, so a caller that skips the body entirely still relies on close to release the connection (HTTP-41 / BODY-15).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:24-24` · high · sha:c2bf15dc8a06</sub>
- A response MUST be closeable, with its close idempotent and forwarding to the body, so it can be released in a scoped block whether or not the body was consumed (HTTP-43).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:24-24` · high · sha:c2bf15dc8a06</sub>
- Convenience readers that materialize the whole body as string or byte array MUST close the body in a finally-style guarantee whether or not the read succeeds (BODY-16).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:25-25` · high · sha:c2bf15dc8a06</sub>
- Reading a response body as text MUST default its charset to the media type's declared charset, falling back to UTF-8 when none is declared or the declared charset is unknown (HTTP-42).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:26-26` · high · sha:c2bf15dc8a06</sub>
- Turning an error response into an exception MUST buffer at most a fixed cap of 1 MiB of the error body into memory and re-serve it as a replayable body, dropping bytes beyond the cap (HTTP-52 / BODY-30).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:46-46` · high · sha:c2bf15dc8a06</sub>
- The buffered error-body copy MUST be readable independently and repeatably after the transport connection is released, and buffering MUST occur inside the original body's close-guaranteeing scope so a provider/buffer-allocation failure still releases the connection (HTTP-52 / BODY-30).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:46-46` · high · sha:c2bf15dc8a06</sub>
- A response with no body MUST be returned unchanged by the error-to-exception path (HTTP-52 / BODY-30).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:46-46` · high · sha:c2bf15dc8a06</sub>
- Error-to-exception mapping MUST apply only to 4xx/5xx responses; a non-error non-success response such as 304 or an unfollowed 3xx MUST be returned with its body intact (BODY-31).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:46-46` · high · sha:c2bf15dc8a06</sub>
- Byte-capped snapshot/preview operations MUST reject a negative cap, silently clamp the cap to the platform's maximum single-array size, and return whatever bytes are available up to the clamped cap (BODY-32).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:47-47` · high · sha:c2bf15dc8a06</sub>
- A capless snapshot MUST fail loudly when the captured size exceeds the platform maximum rather than attempt an impossible allocation (BODY-32).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:47-47` · high · sha:c2bf15dc8a06</sub>
- An exception-side error-body preview SHOULD be non-consuming, reading from a fresh peek view and returning null when there is no body and empty when exhausted (BODY-33).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:47-47` · high · sha:c2bf15dc8a06</sub>
- Body logging on both the request and response sides MUST engage only when body-level logging is enabled, and the in-memory capture on both sides MUST be bounded by one shared preview-size configuration (BODY-34).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:48-48` · high · sha:c2bf15dc8a06</sub>
- A step that re-drives the chain via fork() is responsible for calling close() on whatever response its own prior attempt produced before invoking the fork again, mirroring the reference's placement of this responsibility on the wrapping step rather than on the pipeline runtime itself.
  <sub>design · `docs/sdk-design-nodejs/05-pipeline-architecture.md:66-68` · high · sha:16ad31311df7</sub>

## Constraints
- The consumer MUST still receive every byte of an over-preview body; only the logged preview and size fields are bounded by the preview cap (BODY-34).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:48-48` · high · sha:c2bf15dc8a06</sub>
- The materialize-once boolean guard is only sound if the check-and-flip happens before the first `await` inside the guarded async function, because once execution suspends at an `await`, another logical call can interleave on the same event-loop turn and reintroduce the original race.
  <sub>design · `docs/sdk-design-nodejs/06-retry-redirect-and-authentication.md:42-47` · high · sha:b0e2bb42d809</sub>

## Conclusions
- Node's single-threaded event loop collapses the reference's atomic compare-and-set guard for materialize-once body replay into a plain boolean flag checked and set synchronously.
  <sub>design · `docs/sdk-design-nodejs/06-retry-redirect-and-authentication.md:38-42` · high · sha:b0e2bb42d809</sub>

## Reference
- The reference implementation of the consume-once guard for a single-use body is an atomic compare-and-set (BODY-3 / HTTP-37).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:9-9` · high · sha:c2bf15dc8a06</sub>
- In the reference implementation, the buffered-source-backed single-use body drains and closes its source during write, while the raw byte-stream-backed bodies do not close their stream during write — the rewindable variant keeps it open to replay and the one-shot variant leaves the caller-supplied stream unclosed per its documented ownership (BODY-8).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:10-10` · high · sha:c2bf15dc8a06</sub>
- A file body MAY expose a read-only memory-mapped view of its byte range for local hashing/signing without heap copying, rejecting a range larger than a single addressable buffer (BODY-36).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:13-13` · high · sha:c2bf15dc8a06</sub>
- Response-lifecycle discipline across re-drives (PIPE-40: close every superseded intermediate response, never close the one finally returned) maps onto ReadableStream.cancel() for an unread body and the SDK's own Response.close() for a body that may have been partially read.
  <sub>design · `docs/sdk-design-nodejs/05-pipeline-architecture.md:63-66` · high · sha:16ad31311df7</sub>
- Response.close() cancels the underlying stream and releases the transport's connection handle.
  <sub>design · `docs/sdk-design-nodejs/05-pipeline-architecture.md:65-66` · high · sha:16ad31311df7</sub>

## Conflicts

## Superseded
