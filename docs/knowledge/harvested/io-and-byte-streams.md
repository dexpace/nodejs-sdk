# io-and-byte-streams

## Rules
- A source read MUST append bytes to the tail of a caller-provided destination buffer, never overwriting existing content, and return the number transferred: at least 1 when the requested count is positive and the source is not exhausted, exactly 0 when the requested count is 0, -1 at end-of-stream, and never more than requested (IO-1).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:7-7` · high · sha:33e67b0b29cd</sub>
- A read of count 0 MUST return 0 and MUST NOT report end-of-stream, even on an exhausted source, because underlying libraries often collapse a zero-byte read against an exhausted stream to -1, making callers falsely conclude EOF (IO-2).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:8-8` · high · sha:33e67b0b29cd</sub>
- A negative count passed to any size-taking read/write/copy MUST be rejected as an argument-validation error before any I/O occurs (IO-3).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:9-9` · high · sha:33e67b0b29cd</sub>
- A sink write MUST remove exactly the requested number of bytes from the head of the source buffer and push them downstream; if the source holds fewer bytes, it MUST fail with an I/O error rather than write a partial amount (IO-4).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:10-10` · high · sha:33e67b0b29cd</sub>
- A sink MUST expose flush, pushing buffered bytes toward the destination, and both source and sink MUST be closeable (IO-5).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:11-11` · high · sha:33e67b0b29cd</sub>
- The sink surface SHOULD distinguish emit, a cheap one-level handoff, from flush, a full force-out; a pure in-memory buffer MAY make both no-ops returning self (IO-18).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:11-11` · high · sha:33e67b0b29cd</sub>
- A buffer MUST behave as a FIFO byte queue that is simultaneously a source and a sink — bytes written through the sink surface read back through the source surface in exact order — with a size reflecting bytes currently held (IO-7).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:15-15` · high · sha:33e67b0b29cd</sub>
- A buffer snapshot MUST return a fresh, independent byte-array copy of the current contents without consuming or mutating the buffer, so later mutations do not affect a returned snapshot and vice versa (IO-8).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:16-16` · high · sha:33e67b0b29cd</sub>
- Materializing an entire buffer, or a length-bounded slice read, as one contiguous byte array SHOULD refuse sizes exceeding the host's maximum single-array allocation, failing with an actionable message pointing at streaming alternatives rather than a low-level allocation crash (IO-9).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:17-17` · high · sha:33e67b0b29cd</sub>
- Clear MUST discard every byte in a buffer (IO-10).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:18-18` · high · sha:33e67b0b29cd</sub>
- Copy-to MUST copy a specified window into another buffer without consuming or mutating the source, defaulting to "from offset through end" and rejecting out-of-range windows (IO-10).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:18-18` · high · sha:33e67b0b29cd</sub>
- Closing a source, sink, or buffer MUST be idempotent: a second close MUST NOT throw, and the underlying resource is closed at most once (IO-41).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:19-19` · high · sha:33e67b0b29cd</sub>
- A buffered source/sink wrapping an external stream MUST reject read/write/flush/emit after close with an I/O error, but a purely in-memory buffer is exempt on its own read/write surface so snapshot-after-close logging still works (IO-42).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:20-20` · high · sha:33e67b0b29cd</sub>
- An in-memory buffer's close MUST still invalidate every slice derived from it, even though the buffer's own read/write surface remains usable after close (IO-42).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:20-20` · high · sha:33e67b0b29cd</sub>
- exhausted() MUST return true exactly when no more bytes are available, and may block waiting on an upstream source (IO-11).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:24-24` · high · sha:33e67b0b29cd</sub>
- A single-byte read MUST return the next byte or fail with EOF, and a count-less byte-array read MUST return all remaining bytes, empty when already exhausted (IO-11).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:24-24` · high · sha:33e67b0b29cd</sub>
- An exact-count read MUST return exactly the requested count or fail with EOF; it MUST NOT return a short result, because length-prefixed framing needs all-or-nothing exact reads (IO-12).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:25-25` · high · sha:33e67b0b29cd</sub>
- UTF-8 and explicit-charset reads MUST decode with the specified encoding, with symmetric write-side encodings (IO-13).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:26-26` · high · sha:33e67b0b29cd</sub>
- A UTF-8 line read MUST consume the next line terminator and return the preceding bytes as UTF-8, treating both "\n" and "\r\n" as terminators, returning null when exhausted before any byte, returning a final unterminated line as-is, and keeping a lone "\r" not followed by "\n" as line content (IO-14).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:27-27` · high · sha:33e67b0b29cd</sub>
- Skip MUST advance past exactly the requested count, failing with EOF if fewer bytes remain; skip(0) MUST be a no-op even at or after EOF (IO-15).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:28-28` · high · sha:33e67b0b29cd</sub>
- A buffered source SHOULD provide a read-only host-native byte-stream bridge whose single-byte read returns 0–255 or -1 at end and whose bulk read returns the count or -1, with closing the bridge closing the owning source (IO-16).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:29-29` · high · sha:33e67b0b29cd</sub>
- A buffered sink SHOULD symmetrically provide a writable-stream bridge whose close closes the sink (IO-16).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:29-29` · high · sha:33e67b0b29cd</sub>
- A peek MUST return a non-consuming view over the whole remaining source such that reads from it do not advance the original's cursor, so repeatable body reads (logging previews, response replay) can read the same bytes without disturbing the primary consumer (IO-19).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:33-33` · high · sha:33e67b0b29cd</sub>
- A slice(offset, count) MUST return a non-consuming, length-bounded view exposing at most count bytes starting offset bytes ahead of the current cursor; reads from it MUST NOT advance the parent, and reading past the window behaves as end-of-window (IO-20).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:34-34` · high · sha:33e67b0b29cd</sub>
- Slice offset overflow MUST be detected lazily — constructing a slice whose offset exceeds the source size MUST succeed, surfacing only on first read as empty/EOF — because callers may slice speculatively before the full body length is known (IO-21).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:35-35` · high · sha:33e67b0b29cd</sub>
- A negative slice offset or count MUST be rejected eagerly at construction (IO-21).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:35-35` · high · sha:33e67b0b29cd</sub>
- Closing a slice MUST NOT close its parent or advance the parent's cursor, but closing the parent MUST invalidate every outstanding slice so subsequent reads fail loudly rather than returning stale bytes (IO-22).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:36-36` · high · sha:33e67b0b29cd</sub>
- Reading from a slice after it has been explicitly closed MUST fail loudly with a state error, distinct from normal EOF (IO-24).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:36-36` · high · sha:33e67b0b29cd</sub>
- Multiple slices and peeks of one source MUST be mutually independent, each with its own cursor and budget (IO-23).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:37-37` · high · sha:33e67b0b29cd</sub>
- A slice-of-a-slice MUST compose offsets additively and cap at the outer slice's remaining bytes (IO-23).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:37-37` · high · sha:33e67b0b29cd</sub>
- A write-all MUST pump the source to exhaustion into the sink and return the total transferred, terminating only on a -1 read (IO-17).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:42-42` · high · sha:33e67b0b29cd</sub>
- When pumping a foreign source, a read returning 0 for a non-zero requested count MUST be raised as an I/O error — a source-contract violation — never tolerated as EOF or spun on forever (IO-17).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:42-42` · high · sha:33e67b0b29cd</sub>
- A tee sink MUST mirror written bytes into an in-memory tap and forward the full, untruncated payload to its primary sink; the wire body MUST never be reduced or altered by the tap (IO-25).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:43-43` · high · sha:33e67b0b29cd</sub>
- The tee MUST support a tap capacity limit — once reached, further writes stop copying into the tap while still forwarding the full payload; the default limit is effectively unbounded, and a limit of 0 mirrors nothing while forwarding everything (IO-26).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:43-43` · high · sha:33e67b0b29cd</sub>
- The tee MUST mirror attempted bytes into the tap before forwarding to the primary, so a failed primary write still captures the attempted bytes, and MUST clear its staging buffer even on a failed write so a later write does not prepend stale bytes (IO-27).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:43-43` · high · sha:33e67b0b29cd</sub>
- The tee MUST NOT expose a direct backing-buffer handle, directing callers to the typed write methods instead, because a raw buffer write would reach only the tap or only the primary and silently corrupt the wire body (IO-28).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:43-43` · high · sha:33e67b0b29cd</sub>
- The tee's own flush/close/emit MUST forward to the primary sink only, leaving the in-memory tap intact for later snapshotting (IO-29).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:43-43` · high · sha:33e67b0b29cd</sub>
- A lazy typed-response wrapper MUST expose raw status/headers/protocol/reason/request without consuming the body, and MUST parse the typed value at most once on first access, memoizing the outcome so every later access returns the same value or re-throws the same failure without re-running the handler or re-reading the single-use body (HTTP-44).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:30-30` · high · sha:c2bf15dc8a06</sub>
- Both a null success and a thrown failure MUST be memoized by the lazy typed-response wrapper (HTTP-44).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:30-30` · high · sha:c2bf15dc8a06</sub>
- Concurrent first accesses to the lazy typed-response wrapper MUST be serialized so the handler runs exactly once, using a lock that cooperates with lightweight/virtual-thread schedulers rather than an intrinsic monitor that pins the carrier across the parse (HTTP-45).
  <sub>spec · `docs/product-spec/06-request-and-response-body-lifecycle.md:30-30` · high · sha:c2bf15dc8a06</sub>

## Constraints
- Even though individual streaming instances are single-threaded, the CLOSE state of a source/buffer MUST be observable across threads to slices derived from it, so a close on one thread reliably invalidates a slice being read on another (IO-38).
  <sub>spec · `docs/product-spec/05-i-o-contracts.md:38-38` · high · sha:33e67b0b29cd</sub>

## Conclusions

## Reference

## Conflicts

## Superseded
