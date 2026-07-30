# seams-and-extensibility

## Rules
- A single seam implementation on the classpath is auto-discovered with no bootstrap call; zero or multiple candidates fail loudly (SEAM-5).
  <sub>spec · `docs/product-spec/01-product-overview.md:9-9` · high · sha:4f786c44354d</sub>
- The byte-stream provider MUST expose factory operations to create a new empty in-memory buffer, a buffered reader over a raw input stream, a buffered reader over a byte array, a buffered writer over a raw output stream, and wrappers that add the buffered surface to a primitive source/sink (SEAM-3).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:7-7` · high · sha:0adae2d6a47f</sub>
- A reader/writer created over a caller's raw stream takes ownership of that stream, so closing the reader/writer closes the underlying stream (SEAM-3).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:7-7` · high · sha:0adae2d6a47f</sub>
- The synchronous transport MUST be a single-operation contract — given one request, produce one response — and MUST NOT pre-buffer the response body, leaving the caller to own reading and closing it (SEAM-11).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:12-12` · high · sha:0adae2d6a47f</sub>
- A synchronous transport MAY accept per-call options, but a transport that ignores options MUST behave identically to the no-options call (SEAM-11).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:12-12` · high · sha:0adae2d6a47f</sub>
- The async transport's returned future MUST complete either with a non-null response, which the caller owns closing, or exceptionally; it MUST NOT complete successfully with a null or absent value (SEAM-16).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:17-17` · high · sha:0adae2d6a47f</sub>
- Cancelling an already-completed success future does NOT close the delivered response body; the caller MUST still close it (SEAM-16).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:17-17` · high · sha:0adae2d6a47f</sub>
- Wrapping a blocking transport as async REQUIRES a caller-supplied executor with intentionally no default, because a shared global fork/join-style pool is explicitly unacceptable since a blocking call would starve it (SEAM-18).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:19-19` · high · sha:0adae2d6a47f</sub>
- Wrapping an async transport as blocking MUST unwrap the async-wrapper exception so callers see the original failure, and the blocking wait MUST honor interruption by restoring the interrupt flag, cancelling the in-flight future, and surfacing an interrupted-I/O error (SEAM-18).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:19-19` · high · sha:0adae2d6a47f</sub>
- Per-call options MUST be threaded through the sync-to-async and async-to-sync bridges, not dropped (SEAM-18).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:19-19` · high · sha:0adae2d6a47f</sub>
- On any path where a send produces a response the returned future will not hand to a caller because it was already cancelled or completed exceptionally, the producer MUST close that orphaned response so its connection/descriptor is not leaked (SEAM-30).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:20-20` · high · sha:0adae2d6a47f</sub>
- The wire-codec seam MUST bundle a serializer, a deserializer, and the media type its serializer produces, and the media type MUST NOT be defaulted at the seam level — each codec declares its own (SEAM-19).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:24-24` · high · sha:0adae2d6a47f</sub>
- Deserialization MUST require an explicit runtime type token rather than an erased/inferred generic, so a language with type erasure recovers the intended type instead of silently producing a generic map/list (SEAM-21).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:25-25` · high · sha:0adae2d6a47f</sub>
- Parametric deserialization targets MUST be expressible through a full generic type capture (SEAM-21).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:25-25` · high · sha:0adae2d6a47f</sub>
- Provider resolution MUST follow a fixed precedence: an explicitly installed provider always wins; otherwise the runtime auto-discovers providers registered on the classpath/plugin registry (SEAM-5).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:34-34` · high · sha:0adae2d6a47f</sub>
- Resolution MUST throw a descriptive error naming the install hint when zero providers are discoverable, and a descriptive error listing all candidates when more than one distinct provider is discoverable; exactly one discoverable provider is selected silently (SEAM-5).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:34-34` · high · sha:0adae2d6a47f</sub>
- Explicit installation MUST be idempotent for the same instance and MUST reject installing a different provider when one is already installed, naming both in the error (SEAM-6).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:35-35` · high · sha:0adae2d6a47f</sub>
- A successful auto-resolution MUST be cached process-wide (SEAM-7).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:36-36` · high · sha:0adae2d6a47f</sub>
- When an explicit install replaces a different provider that had already been auto-resolved and handed out, the runtime SHOULD emit a warning rather than fail, because objects may already exist against the previous provider (SEAM-8).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:38-38` · high · sha:0adae2d6a47f</sub>
- The registry SHOULD tolerate one logical provider seen through more than one loader without misreporting it as multiple, de-duplicating by concrete implementation identity, and SHOULD recognize a thin delegating shim as its canonical target (SEAM-10).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:39-39` · high · sha:0adae2d6a47f</sub>
- The I/O provider seam MUST offer factories to create a fresh empty buffer, wrap a caller stream and a byte array as buffered sources, wrap a caller stream as a buffered sink, and wrap a foreign primitive source/sink with the typed surface; each buffer MUST be fresh, independent, and empty, and the byte-array-wrapping source MUST be an independent copy of the input (IO-30).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:47-47` · high · sha:33e67b0b29cd</sub>
- The provider registry SHOULD support lock-free reads of the active provider while serializing installs/swaps under a lock that does not pin/park carrier threads under lightweight-thread schedulers (IO-39).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:49-49` · high · sha:33e67b0b29cd</sub>
- A mirroring/wrapping sink MUST NOT swallow or duplicate the wrapped stream's cancellation handling; prompt cancellation of blocked I/O belongs to the transport that owns the real socket, not to the in-memory I/O layer (IO-40).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:50-50` · high · sha:33e67b0b29cd</sub>
- The core's declared media type must remain undefaulted at the seam level, per SEAM-19.
  <sub>design · `docs/sdk-design-nodejs/03-seam-by-seam-idiomatic-mapping.md:103-104` · high · sha:b691aee1e452</sub>

## Constraints
- Provider factory operations MUST be safe to invoke concurrently from many threads, but the buffer/reader/writer instances they return are not required to be thread-safe and are confined to a single logical operation (SEAM-4).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:8-8` · high · sha:0adae2d6a47f</sub>
- Both synchronous and asynchronous transports MUST be safe for concurrent calls, with all per-request state confined to locals or the returned response/future graph (SEAM-12).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:13-13` · high · sha:0adae2d6a47f</sub>
- Resolution/install/swap state MUST be concurrency-safe: reads observe the latest install without blocking, writes are serialized so two concurrent installs cannot both pass the conflict check, and a concurrent first-access cannot run the discovery scan twice (SEAM-9).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:37-37` · high · sha:0adae2d6a47f</sub>
- All streaming instances (source, sink, buffered source/sink, buffer, tee) are single-threaded contracts, not required to be safe for concurrent use; callers must serialize external access, though independent views may be used from different threads (IO-37).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:48-48` · high · sha:33e67b0b29cd</sub>
- I/O contracts MUST NOT impose their own read/write timeout — the adapter wraps foreign streams with a no-op timeout, delegating deadlines to the transport (IO-40).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:50-50` · high · sha:33e67b0b29cd</sub>

## Conclusions
- An unresolved provider state (zero or multiple candidates, which throws) MUST remain re-evaluable so a later-registered provider or explicit install can still take effect, because caching a failure would permanently wedge a process that later gains a provider (SEAM-7).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:36-36` · high · sha:0adae2d6a47f</sub>
- The port satisfies the behavioral contract of the byte-stream provider seam (IO-1 through IO-42) without reproducing the pluggability mechanism of SEAM-3/SEAM-4, because ReadableStream<Uint8Array>/WritableStream<Uint8Array> are WHATWG-standard and natively implemented across Node, browsers, Deno, Bun, and Cloudflare Workers.
  <sub>design · `docs/sdk-design-nodejs/03-seam-by-seam-idiomatic-mapping.md:5-10` · high · sha:b691aee1e452</sub>
- Because there is no pluggable byte-stream factory in the port, SEAM-5 through SEAM-10's discovery/registration/conflict-resolution machinery (install precedence, idempotent install, caching, de-duplication) is moot, making this the single largest simplification the Node port makes relative to the reference.
  <sub>design · `docs/sdk-design-nodejs/03-seam-by-seam-idiomatic-mapping.md:26-30` · high · sha:b691aee1e452</sub>
- The port collapses SEAM-11 (synchronous transport) and SEAM-16 (asynchronous transport) into one Transport seam because Node's single-threaded event loop makes every I/O operation asynchronous by construction, and faking a blocking API via Atomics.wait would be the same kind of hack the reference explicitly rules out in SEAM-18.
  <sub>design · `docs/sdk-design-nodejs/03-seam-by-seam-idiomatic-mapping.md:40-52` · high · sha:b691aee1e452</sub>
- The Promise<Response>-shaped Transport contract satisfies SEAM-11's requirement that the response body remain a lazy ReadableStream and SEAM-16's requirement that completion be either a non-null response or an exception, because a native Promise<T> cannot resolve to nothing and cannot type-check while resolving undefined.
  <sub>design · `docs/sdk-design-nodejs/03-seam-by-seam-idiomatic-mapping.md:60-64` · high · sha:b691aee1e452</sub>
- @dexpace/rx is the only async-adapter package the port ships, and it exists because RxJS's Observable is a genuinely different shape (push-based, multi-value, cancellable-by-unsubscribe) that some teams prefer for pagination/SSE streams, not because Promise itself needs bridging.
  <sub>design · `docs/sdk-design-nodejs/03-seam-by-seam-idiomatic-mapping.md:67-70` · high · sha:b691aee1e452</sub>
- @dexpace/codec-json ships as a separate package rather than inside @dexpace/core, preserving SEAM-2's rule that core must not reference any concrete implementation of a seam by name, even though embedding it would cost nothing dependency-wise.
  <sub>design · `docs/sdk-design-nodejs/03-seam-by-seam-idiomatic-mapping.md:100-104` · high · sha:b691aee1e452</sub>
- With the byte-stream seam no longer pluggable and the async pivot no longer fragmented, the only seam retaining a genuine discovery/registration story in the port is the logging facade.
  <sub>design · `docs/sdk-design-nodejs/03-seam-by-seam-idiomatic-mapping.md:131-133` · high · sha:b691aee1e452</sub>
- A TypeScript interface with no runtime representation compiles away entirely, making the logging facade a cheaper zero-dependency seam than the JVM reference's SLF4J compileOnly jar, which still needs a real class file present at compile time and, if touched, at runtime.
  <sub>design · `docs/sdk-design-nodejs/03-seam-by-seam-idiomatic-mapping.md:135-137` · high · sha:b691aee1e452</sub>

## Reference
- The reference implementation resolves providers via a ServiceLoader over classpath service entries, with a registration shim because a JVM singleton object cannot be reflectively instantiated (SEAM-10).
  <sub>spec · `docs/product-spec/03-pluggable-seams-and-extension-model.md:39-39` · high · sha:0adae2d6a47f</sub>
- I/O provider resolution follows the same precedence, idempotence, caching, warning, and de-duplication rules as the seam provider discovery rules SEAM-5 through SEAM-10 (IO-31 through IO-36).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:47-47` · high · sha:33e67b0b29cd</sub>
- A provider/seam is a narrow abstraction (SPI) the core depends on but never implements, behind which a concrete capability such as I/O, transport, or serde plugs in.
  <sub>spec · `docs/product-spec/appendix-a-glossary.md:49` · high · sha:f0b3d2058626</sub>
- ByteQueue is a Buffer-equivalent FIFO byte queue backed by a linked list of Uint8Array chunks, satisfying IO-7 through IO-10, with a snapshot() method that copies (IO-8) and a copyTo(window) method that does not consume (IO-10).
  <sub>design · `docs/sdk-design-nodejs/03-seam-by-seam-idiomatic-mapping.md:12-14` · high · sha:b691aee1e452</sub>
- BufferedSource/BufferedSink wrap a ReadableStreamDefaultReader/WritableStreamDefaultWriter, exposing exact-count reads, UTF-8/charset decode via TextDecoder, and WHATWG-line reads honoring \n, \r, and \r\n per IO-11 through IO-16, plus non-consuming peek()/slice(offset, count) views per IO-19 through IO-24 implemented as thin cursors over the same ByteQueue.
  <sub>design · `docs/sdk-design-nodejs/03-seam-by-seam-idiomatic-mapping.md:15-20` · high · sha:b691aee1e452</sub>
- TeeSink satisfies IO-25 through IO-29 and is built on TransformStream with a side-channel tap buffer rather than the platform's ReadableStream.tee(), because tee() duplicates a readable stream for two consumers whereas TeeSink mirrors a sink's writes into a bounded tap while forwarding the full payload untruncated.
  <sub>design · `docs/sdk-design-nodejs/03-seam-by-seam-idiomatic-mapping.md:21-24` · high · sha:b691aee1e452</sub>
- Interop with Node's stream.Readable/Writable is provided at the edge via Node's built-in Readable.toWeb()/Readable.fromWeb() conversions (part of node:stream since Node 17), a zero-added-dependency bridge that exists only on Node, not on Deno/Bun/Workers.
  <sub>design · `docs/sdk-design-nodejs/03-seam-by-seam-idiomatic-mapping.md:32-36` · high · sha:b691aee1e452</sub>
- The unified Transport interface is defined as `interface Transport { send(request: Request, options?: RequestOptions, signal?: AbortSignal): Promise<Response> }`.
  <sub>design · `docs/sdk-design-nodejs/03-seam-by-seam-idiomatic-mapping.md:54-58` · high · sha:b691aee1e452</sub>
- SEAM-17's canonical, dependency-free async primitive is native Promise, and unlike the JVM there is no second async ecosystem to reconcile against it since every Node-adjacent framework already treats Promise/await as its own native idiom.
  <sub>design · `docs/sdk-design-nodejs/03-seam-by-seam-idiomatic-mapping.md:64-67` · high · sha:b691aee1e452</sub>
- SEAM-19's bundle-of-{serializer, deserializer, declared media type} maps to a small Serde<T>-shaped structural interface exposing mediaType: string, serialize, and deserialize.
  <sub>design · `docs/sdk-design-nodejs/03-seam-by-seam-idiomatic-mapping.md:97-99` · high · sha:b691aee1e452</sub>
- @dexpace/codec-json, the reference implementation, wraps JSON.stringify/JSON.parse and is genuinely zero-dependency because JSON is a language built-in, not an npm package.
  <sub>design · `docs/sdk-design-nodejs/03-seam-by-seam-idiomatic-mapping.md:98-100` · high · sha:b691aee1e452</sub>
- @dexpace/core defines Logger/LogEvent as pure TypeScript structural interfaces with a shared, allocation-minimal no-op default.
  <sub>design · `docs/sdk-design-nodejs/03-seam-by-seam-idiomatic-mapping.md:133-135` · high · sha:b691aee1e452</sub>

## Conflicts

## Superseded
