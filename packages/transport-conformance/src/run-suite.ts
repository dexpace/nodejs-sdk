// SPDX-License-Identifier: MIT
// packages/transport-conformance/src/run-suite.ts
// The single TRANSPORT-N conformance suite, run once per transport package so the two adapters cannot
// drift. Exercises: TRANSPORT-1..9, TRANSPORT-11..17, TRANSPORT-20..21, TRANSPORT-23..29, BODY-13,
// SEAM-12, SEAM-16, SEAM-30, NFR-15, and AUTH-12/AUTH-25 to the extent a transport is
// answerable for them (the repeated-challenge-header row). TRANSPORT-10..13's SHARED half -- the one
// outbound header pass both adapters call -- is asserted at its source in
// @dexpace/transport-shared; the rows here cover what each adapter decides for itself, which since
// audit #67 / #81 includes TRANSPORT-11/12's per-header degrade, because the two adapters had four
// different answers for the same model-valid header and only a shared row could say so.
// TRANSPORT-18's collapse is a Deviation Ledger row, as is TRANSPORT-28's zero-copy SHOULD, whose two
// MUSTs the file-body rows do assert; TRANSPORT-30's
// full flow is transport-undici's challenge-handler.test.ts. TRANSPORT-22 is NOT driven from here --
// forcing an adaptation throw needs a per-transport hook into the native response, so each adapter
// asserts it against its own (transport-fetch's fetch-transport.test.ts:118, transport-undici's
// undici-transport.test.ts:503).
import {mkdtemp, rm, truncate, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, beforeAll, describe, expect, test} from 'bun:test';
import {
  getBuildInfo,
  getGlobalLogger,
  Headers,
  Request,
  RequestOptions,
  setGlobalLogger,
  type Body,
  type Logger,
  type Transport,
} from '@dexpace/core';
import {
  fileBodyFixture,
  REPEATED_CHALLENGES,
  startFixtureServer,
  type TestServer,
} from './fixtures.js';

/**
 * The clauses `docs/product-spec/17-transport-adapter-conformance-contract.md` scopes to only one
 * reference transport, plus the one drop-set entry that legitimately differs between the two.
 */
export interface TransportCapabilities {
  /** TRANSPORT-8: the transport has an internal-cancel path distinct from a caller abort. */
  readonly supportsInternalCancel: boolean;
  /**
   * TRANSPORT-30: the transport can be configured with a proxy at all. The proxy behaviour itself is
   * asserted in `transport-undici`'s own tests, because only that package can construct one.
   */
  readonly supportsProxy: boolean;
  /** TRANSPORT-11: whether `Connection` is in this transport's outbound drop set. */
  readonly dropsConnectionHeader: boolean;
}

/** What every row below needs: a transport factory, the live fixture origin, and the capability flags. */
interface SuiteContext {
  readonly makeTransport: () => Transport;
  readonly capabilities: TransportCapabilities;
  /** Resolves a fixture path against the server started in `beforeAll`; read lazily, at run time. */
  url(path: string): string;
  /**
   * The same fixture, on a second origin, for rows that deliberately leave a connection unusable.
   *
   * A row that makes the server answer before draining the request body strands the remainder of
   * that body in the socket. Whether the client then reuses it is the client's business, and a
   * client that gets it wrong does not fail *here* -- it fails in whichever later row is handed the
   * poisoned connection, which is a debugging problem of a different order. Bun 1.3.14 gets it
   * wrong: it serves the resulting `400` from its pool, so `a per-call timeout is retryable` saw a
   * 1ms resolve some thirty rows downstream. Neither `connection: close` nor destroying the socket
   * server-side prevents it -- verified -- because the decision is entirely the client's.
   *
   * A separate origin is therefore the only thing this suite controls that contains the blast
   * radius. Pathological rows get their own pool; every other row keeps the shared one.
   */
  isolatedUrl(path: string): string;
}

/**
 * Awaits `pending` and hands back its rejection reason.
 *
 * Deliberately not `expect(pending).rejects.…`: that form is typed `void` here, so a row that has to
 * assert something *after* the rejection (a `close()` that must not stall, say) would race its own
 * assertion. This settles first, then asserts.
 */
/** How long the post-delivery producer stalls before failing; long enough to outlive `send`. */
const POST_DELIVERY_MS = 150;

async function rejection(pending: Promise<unknown>): Promise<unknown> {
  try {
    await pending;
  } catch (error) {
    return error;
  }
  throw new Error('expected the send to reject, but it resolved');
}

/** Creates a transport, runs `body` against it, and closes it on every exit path. */
async function withTransport<T>(
  make: () => Transport,
  body: (transport: Transport) => Promise<T>,
): Promise<T> {
  const transport = make();
  try {
    return await body(transport);
  } finally {
    await transport.close();
  }
}

/**
 * Runs `body` with a capturing global logger installed and returns every `header` field the
 * drop log emitted, lower-cased. Restores the previous logger on every exit path.
 */
async function captureDroppedHeaders(
  body: () => Promise<void>,
): Promise<string[]> {
  const dropped: string[] = [];
  const previous: Logger = getGlobalLogger();
  const capturing: Logger = {
    atLevel: () => {
      let name: string | undefined;
      const entry = {
        field: (key: string, value: unknown) => {
          if (key === 'header') name = String(value);
          return entry;
        },
        event: () => entry,
        cause: () => entry,
        emit: () => {
          if (name !== undefined) dropped.push(name.toLowerCase());
        },
      };
      return entry;
    },
    withContext: () => capturing,
  };
  setGlobalLogger(capturing);
  try {
    await body();
  } finally {
    setGlobalLogger(previous);
  }
  return dropped;
}

async function readEchoedHeaders(
  transport: Transport,
  request: Request,
): Promise<Record<string, string>> {
  const response = await transport.send(request);
  return JSON.parse(await response.text()) as Record<string, string>;
}

function registerDispatchRows(ctx: SuiteContext): void {
  describe('TRANSPORT-1/2/21/23: dispatch, pipeline authority, null-safety', () => {
    test('a 302 is returned raw, never followed by the native client', async () => {
      await withTransport(ctx.makeTransport, async transport => {
        const request = Request.newBuilder().url(ctx.url('/redirect')).build();
        const response = await transport.send(request);
        expect(response.status.code).toBe(302);
        expect(response.headers.get('location')).toBe('/echo-headers');
        await response.close();
      });
    });

    test('a failure is delivered through the promise, never a synchronous throw', async () => {
      await withTransport(ctx.makeTransport, async transport => {
        const request = Request.newBuilder().url('http://127.0.0.1:1').build();
        // Reaching the next line at all is the assertion: a synchronous throw would abort the test
        // here rather than surface through the promise (TRANSPORT-21).
        const pending = transport.send(request);
        expect(pending).toBeInstanceOf(Promise);
        expect(await rejection(pending)).toBeDefined();
      });
    });

    test('a success never resolves to a null or undefined response', async () => {
      await withTransport(ctx.makeTransport, async transport => {
        const request = Request.newBuilder()
          .url(ctx.url('/echo-headers'))
          .build();
        const response = await transport.send(request);
        expect(response).toBeDefined();
        expect(response.request.url.href).toBe(ctx.url('/echo-headers'));
        await response.close();
      });
    });
  });
}

function registerStatusRows(ctx: SuiteContext): void {
  describe('TRANSPORT-24/26/27: status fidelity and inbound downgrades', () => {
    test('a vendor 520 is surfaced faithfully with a readable body', async () => {
      await withTransport(ctx.makeTransport, async transport => {
        const request = Request.newBuilder()
          .url(ctx.url('/vendor-status'))
          .build();
        const response = await transport.send(request);
        expect(response.status.code).toBe(520);
        expect(await response.text()).toBe('vendor status body');
      });
    });

    test('a body-less POST dispatches with a zero-length body, not a throw', async () => {
      await withTransport(ctx.makeTransport, async transport => {
        const request = Request.newBuilder()
          .method('POST')
          .url(ctx.url('/echo-headers'))
          .build();
        const echoed = await readEchoedHeaders(transport, request);
        // TRANSPORT-26: the zero-length substitution is observable as the framing the client
        // computed, not as a rejected send.
        expect(echoed['content-length']).toBe('0');
      });
    });

    test('an unparseable Content-Type downgrades the response rather than failing it', async () => {
      await withTransport(ctx.makeTransport, async transport => {
        const request = Request.newBuilder()
          .url(ctx.url('/malformed-content-type'))
          .build();
        const response = await transport.send(request);
        expect(response.status.code).toBe(200);
        expect(response.headers.get('content-type')).toBe('not-a-media-type');
        expect(await response.text()).toBe('body');
      });
    });
  });
}

function registerBodyRows(ctx: SuiteContext): void {
  describe('TRANSPORT-17/19/25: request bodies written once, response bodies streamed lazily', () => {
    test('a single-use body is written exactly once and its bytes reach the wire', async () => {
      await withTransport(ctx.makeTransport, async transport => {
        let writeCount = 0;
        const payload = new TextEncoder().encode('payload');
        // Built from scratch rather than monkey-patching stringBody: every core model is frozen
        // (HTTP-1), and a replayable body would not exercise the single-use path at all.
        const body: Body = {
          kind: 'stream',
          mediaType: 'text/plain',
          contentLength: payload.byteLength,
          replayable: false,
          async writeTo(sink) {
            writeCount += 1;
            const writer = sink.getWriter();
            await writer.write(payload);
            await writer.close();
          },
        };
        const request = Request.newBuilder()
          .method('POST')
          .url(ctx.url('/echo-body'))
          .body(body)
          .build();
        const response = await transport.send(request);
        expect(await response.text()).toBe('payload');
        expect(writeCount).toBe(1);
      });
    });

    test('the response body streams on demand rather than arriving pre-buffered', async () => {
      await withTransport(ctx.makeTransport, async transport => {
        const request = Request.newBuilder().url(ctx.url('/drip')).build();
        const response = await transport.send(request);
        const stream = response.body;
        if (stream === null) throw new Error('the response carried no body');
        expect(stream).toBeInstanceOf(ReadableStream);
        const reader = stream.getReader();
        const first = await reader.read();
        // The fixture drips for ~1s; a first chunk in hand while the stream is still open is the
        // observable form of "not pre-buffered" (SEAM-11, TRANSPORT-25).
        expect(first.done).toBe(false);
        reader.releaseLock();
        await response.close();
      });
    });

    test('closing without reading releases the connection, idempotently', async () => {
      await withTransport(ctx.makeTransport, async transport => {
        const request = Request.newBuilder().url(ctx.url('/drip')).build();
        const response = await transport.send(request);
        await response.close();
        // Reaching the next line proves close() is idempotent: a second close that threw or hung
        // would fail or time out the row (BODY-15).
        await response.close();
      });
    });
  });
}

function registerProducerRows(ctx: SuiteContext): void {
  describe('TRANSPORT-19: an abandoned or failed request-body producer', () => {
    test('a producer that fails after delivery does not escape as an unhandled rejection', async () => {
      await withTransport(ctx.makeTransport, async transport => {
        // The fixture answers 413 without draining, so `send` resolves while `writeTo` is still
        // parked. The producer then fails with nobody left awaiting it -- and a transport that does
        // not keep a handler on the producer's settlement lets that rejection reach the runtime's
        // default `unhandledRejection` policy, which terminates the process (TRANSPORT-19, SEAM-30).
        // Both `bun test` and `node --test` fail a test that leaks one, so this row needs no
        // process-level listener of its own to be the assertion.
        const body: Body = {
          kind: 'stream',
          mediaType: 'application/octet-stream',
          contentLength: -1,
          replayable: false,
          async writeTo(sink) {
            const writer = sink.getWriter();
            await writer.write(new Uint8Array(1024));
            await new Promise(resolve => setTimeout(resolve, POST_DELIVERY_MS));
            throw new Error('producer failed after the response was delivered');
          },
        };
        const request = Request.newBuilder()
          .method('POST')
          // Quarantined: this row is the one that strands a request body mid-socket.
          .url(ctx.isolatedUrl('/early-response'))
          .body(body)
          .build();
        const response = await transport.send(request);
        expect(response.status.code).toBe(413);
        await response.close();
        // Outlives the producer, so the rejection has actually happened by the time the row ends.
        await new Promise(resolve => setTimeout(resolve, POST_DELIVERY_MS * 3));
      });
    });
  });
}

function registerFailureRows(ctx: SuiteContext): void {
  describe('TRANSPORT-4/5/6/20: failure classification and per-call timeouts', () => {
    test('a dead port surfaces the retryable TransportFailureError', async () => {
      await withTransport(ctx.makeTransport, async transport => {
        const request = Request.newBuilder().url('http://127.0.0.1:1').build();
        expect(await rejection(transport.send(request))).toMatchObject({
          name: 'TransportFailureError',
        });
      });
    });

    test('a per-call timeout is retryable, not a cancellation', async () => {
      await withTransport(ctx.makeTransport, async transport => {
        const request = Request.newBuilder().url(ctx.url('/slow')).build();
        const options = RequestOptions.newBuilder().timeoutMs(50).build();
        expect(await rejection(transport.send(request, options))).toMatchObject(
          {name: 'TransportFailureError'},
        );
      });
    });

    test('two concurrent calls are each bounded by their own timeout', async () => {
      await withTransport(ctx.makeTransport, async transport => {
        const slow = (): Request =>
          Request.newBuilder().url(ctx.url('/slow')).build();
        const started = Date.now();
        // TRANSPORT-5: the per-call override applies to that call only, and neither call waits on
        // the other. Both are awaited, so the transport closes with nothing still in flight.
        const brief = rejection(
          transport.send(
            slow(),
            RequestOptions.newBuilder().timeoutMs(60).build(),
          ),
        );
        const patient = rejection(
          transport.send(
            slow(),
            RequestOptions.newBuilder().timeoutMs(1_200).build(),
          ),
        );
        expect(await brief).toMatchObject({name: 'TransportFailureError'});
        // The short call cannot have been extended to the long call's deadline.
        expect(Date.now() - started).toBeLessThan(1_000);
        expect(await patient).toMatchObject({name: 'TransportFailureError'});
      });
    });

    test('a sub-resolution 1ms timeout still times out rather than hanging', async () => {
      await withTransport(ctx.makeTransport, async transport => {
        const request = Request.newBuilder().url(ctx.url('/slow')).build();
        const options = RequestOptions.newBuilder().timeoutMs(1).build();
        expect(await rejection(transport.send(request, options))).toMatchObject(
          {name: 'TransportFailureError'},
        );
      });
    });
  });
}

function registerCancellationRows(ctx: SuiteContext): void {
  describe('TRANSPORT-3/7/9: cancellation is terminal, and orphans are released', () => {
    test('aborting mid-request yields a terminal CancellationError', async () => {
      await withTransport(ctx.makeTransport, async transport => {
        const controller = new AbortController();
        const request = Request.newBuilder().url(ctx.url('/slow')).build();
        const pending = transport.send(request, undefined, controller.signal);
        setTimeout(() => {
          controller.abort();
        }, 20);
        expect(await rejection(pending)).toMatchObject({
          name: 'CancellationError',
        });
      });
    });

    test('a cancelled exchange leaves no handle that stalls close()', async () => {
      const transport = ctx.makeTransport();
      const controller = new AbortController();
      const request = Request.newBuilder().url(ctx.url('/slow')).build();
      const pending = transport.send(request, undefined, controller.signal);
      setTimeout(() => {
        controller.abort();
      }, 20);
      expect(await rejection(pending)).toBeDefined();
      // A dangling handle would stall this close() until the row times out.
      await transport.close();
    });

    test('an abort after the response was delivered does not close its body (SEAM-16)', async () => {
      await withTransport(ctx.makeTransport, async transport => {
        const controller = new AbortController();
        const request = Request.newBuilder()
          .url(ctx.url('/vendor-status'))
          .build();
        const response = await transport.send(
          request,
          undefined,
          controller.signal,
        );
        controller.abort();
        // The caller owns the delivered body even when the signal fires afterwards; a transport that
        // wired an unconditional abort listener would truncate this read.
        expect(await response.text()).toBe('vendor status body');
      });
    });

    test('a timeout while headers are still pending releases the connection (SEAM-30)', async () => {
      const transport = ctx.makeTransport();
      const request = Request.newBuilder().url(ctx.url('/slow')).build();
      const options = RequestOptions.newBuilder().timeoutMs(50).build();
      expect(await rejection(transport.send(request, options))).toMatchObject({
        name: 'TransportFailureError',
      });
      await transport.close();
    });
  });
}

function registerLifecycleRows(ctx: SuiteContext): void {
  describe('TRANSPORT-15/16/29, SEAM-12: lifecycle and concurrency', () => {
    test('close is idempotent', async () => {
      const transport = ctx.makeTransport();
      await transport.close();
      // A second close that threw or hung would fail or time out the row (TRANSPORT-16).
      await transport.close();
    });

    test('many concurrent sends each resolve to their own response', async () => {
      await withTransport(ctx.makeTransport, async transport => {
        const responses = await Promise.all(
          Array.from({length: 20}, (_unused, index) =>
            transport.send(
              Request.newBuilder()
                .url(ctx.url('/echo-headers'))
                .headers(
                  Headers.newBuilder().set('X-Call', String(index)).build(),
                )
                .build(),
            ),
          ),
        );
        const seen = await Promise.all(
          responses.map(async response => {
            const echoed = JSON.parse(await response.text()) as Record<
              string,
              string
            >;
            return echoed['x-call'];
          }),
        );
        // Per-request state confined to the promise graph: 20 distinct values, no interleaving.
        expect(new Set(seen).size).toBe(20);
      });
    });
  });
}

function registerHeaderRows(ctx: SuiteContext): void {
  describe('TRANSPORT-10/11, NFR-15: the outbound header pass', () => {
    test('a caller-supplied Content-Length never reaches the wire (framing is the client’s)', async () => {
      await withTransport(ctx.makeTransport, async transport => {
        const request = Request.newBuilder()
          .method('POST')
          .url(ctx.url('/echo-headers'))
          .headers(Headers.newBuilder().set('Content-Length', '999').build())
          .body({
            kind: 'byte-array',
            mediaType: 'text/plain',
            contentLength: 5,
            replayable: true,
            async writeTo(sink) {
              const writer = sink.getWriter();
              await writer.write(new TextEncoder().encode('hello'));
              await writer.close();
            },
          })
          .build();
        const echoed = await readEchoedHeaders(transport, request);
        expect(echoed['content-length']).not.toBe('999');
      });
    });

    test('a body-derived Content-Type is stamped when the caller set none', async () => {
      await withTransport(ctx.makeTransport, async transport => {
        const request = Request.newBuilder()
          .method('POST')
          .url(ctx.url('/echo-headers'))
          .body({
            kind: 'byte-array',
            mediaType: 'application/x-conformance',
            contentLength: 2,
            replayable: true,
            async writeTo(sink) {
              const writer = sink.getWriter();
              await writer.write(new Uint8Array([1, 2]));
              await writer.close();
            },
          })
          .build();
        const echoed = await readEchoedHeaders(transport, request);
        expect(echoed['content-type']).toBe('application/x-conformance');
      });
    });

    test('a stamped User-Agent survives the drop pass unmangled', async () => {
      await withTransport(ctx.makeTransport, async transport => {
        const identity = getBuildInfo().identityTokens.join(' ');
        const request = Request.newBuilder()
          .url(ctx.url('/echo-headers'))
          .headers(Headers.newBuilder().set('User-Agent', identity).build())
          .build();
        const echoed = await readEchoedHeaders(transport, request);
        expect(echoed['user-agent']).toBe(identity);
      });
    });
  });
}

/**
 * Headers every model layer in this SDK accepts and at least one shipped native client refuses
 * outright, paired with the value that provokes the refusal.
 *
 * `expect`, `keep-alive` and `upgrade` are `undici`'s three unconditional rejections
 * (`lib/core/request.js:398,409` — `InvalidArgumentError` for the first two, `NotSupportedError`
 * for `expect`), and Node's global `fetch` is undici-backed, so both adapters meet them. `X Custom`
 * is the non-token name: `@dexpace/core` admits any printable ASCII byte in a header name
 * (`http/ascii-validation.ts:29-33`), while both native layers require RFC 9110 `token`.
 *
 * TRANSPORT-12 is what makes these one table rather than four transport-specific quirks: whatever
 * the native client refuses, the transport drops *that header only* and still dispatches.
 */
const NATIVE_REJECTED_HEADERS: readonly (readonly [string, string])[] = [
  ['Expect', '100-continue'],
  ['Keep-Alive', 'timeout=5'],
  ['Upgrade', 'websocket'],
  ['X Custom', 'model-valid, non-token'],
];

function registerNativeRejectionRows(ctx: SuiteContext): void {
  describe('TRANSPORT-11/12/13: a header the native client refuses degrades to a logged drop', () => {
    for (const [name, value] of NATIVE_REJECTED_HEADERS) {
      test(`${name} is dropped and logged, and the rest of the request still dispatches`, async () => {
        let echoed: Record<string, string> = {};
        const dropped = await captureDroppedHeaders(async () => {
          await withTransport(ctx.makeTransport, async transport => {
            const request = Request.newBuilder()
              .url(ctx.url('/echo-headers'))
              .headers(
                Headers.newBuilder()
                  .set(name, value)
                  .set('X-Pass-Through', 'survives')
                  .build(),
              )
              .build();
            echoed = await readEchoedHeaders(transport, request);
          });
        });
        // The send resolved at all, which is TRANSPORT-12's "the resulting native exception MUST NOT
        // escape the send contract"; the two header assertions are its "the bad header is absent,
        // the normal header present".
        expect(echoed[name.toLowerCase()]).toBeUndefined();
        expect(echoed['x-pass-through']).toBe('survives');
        // TRANSPORT-13: the drop is discoverable by name, never silent.
        expect(dropped).toContain(name.toLowerCase());
      });
    }

    test('a Connection value the native client cannot carry is dropped on both transports', async () => {
      // `Connection` is the one name whose drop set legitimately differs (TRANSPORT-11's own note,
      // and `registerDropSetRows` below), so this row asserts the intersection: `upgrade` is neither
      // `close` nor `keep-alive`, undici rejects it outright (`request.js:400-404`), and the WHATWG
      // layer forbids the name entirely. Both must drop it, whichever reason applies.
      //
      // Asserted through the log rather than the echo for the same reason `registerDropSetRows`
      // does: both clients set a `Connection` header of their own, so the wire cannot tell a
      // forwarded caller header from the client's.
      const dropped = await captureDroppedHeaders(async () => {
        await withTransport(ctx.makeTransport, async transport => {
          const request = Request.newBuilder()
            .url(ctx.url('/echo-headers'))
            .headers(Headers.newBuilder().set('Connection', 'upgrade').build())
            .build();
          const response = await transport.send(request);
          expect(response.status.code).toBe(200);
          await response.close();
        });
      });
      expect(dropped).toContain('connection');
    });
  });
}

/**
 * The declared length of the truncate-after-stat file body, deliberately **below** both shipped
 * adapters' 1,000,000-byte materialize bound, so this row drives the buffered path.
 *
 * The streamed path is asserted in `tests/node-conformance/transport.test.mjs` instead, and that is
 * not a preference. Bun 1.3.14's `Readable.fromWeb` leaks the abort reason as two or three unhandled
 * rejections when the web readable behind it is aborted mid-pull, which is exactly what a producer
 * failure on the streamed path does; `bun:test` then fails whichever row happens to be running.
 * Isolated to sixteen lines with no SDK code in them, and clean under `node --test` on both
 * transports (measured 2026-09-05, audit #67 / #81). Raising this constant past 1,000,000 will make
 * the row red for that reason and no other.
 */
const TRUNCATED_FILE_BYTES = 64;

/** How far a truncate-after-stat cuts the file back; small enough that no read can be a full one. */
const TRUNCATED_TO_BYTES = 10;

/** Distinguishable bytes, so a misaligned send fails on content and not merely on length. */
function fileFixtureBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) {
    bytes[index] = 33 + ((index * 7) % 94);
  }
  return bytes;
}

/** Writes `size` fixture bytes to a fresh temporary file, runs `body`, and removes the directory. */
async function withFixtureFile<T>(
  size: number,
  body: (path: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'dexpace-conformance-file-'));
  try {
    const path = join(dir, 'payload.bin');
    await writeFile(path, fileFixtureBytes(size));
    return await body(path);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
}

/**
 * Every message on `error` and its `cause` chain, joined.
 *
 * BODY-13's transferred-of-total text surfaces at a different depth per path: the streamed path
 * rethrows the producer's own failure as the message, while the buffered path wraps it as a cause
 * under a fixed "request body could not be written". Both satisfy the requirement; asserting on the
 * chain is what lets one row cover both without pinning either transport's wrapper wording.
 */
function messageChain(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current instanceof Error; depth += 1) {
    parts.push(current.message);
    current = current.cause;
  }
  return parts.join(' <- ');
}

function registerFileBodyRows(ctx: SuiteContext): void {
  describe('TRANSPORT-28, BODY-13: a file body is dispatched through its own writeTo', () => {
    test('an intact ranged file body puts exactly its declared bytes on the wire', async () => {
      await withFixtureFile(64, async path => {
        const writes = {count: 0};
        await withTransport(ctx.makeTransport, async transport => {
          const response = await transport.send(
            Request.newBuilder()
              .method('POST')
              .url(ctx.url('/echo-body'))
              .body(fileBodyFixture(path, {start: 10, count: 20, writes}))
              .build(),
          );
          expect([...(await response.bytes())]).toEqual([
            ...fileFixtureBytes(64).slice(10, 30),
          ]);
        });
        // TRANSPORT-17's counterpart for a replayable body: a transport that reads `path` itself
        // rather than calling `writeTo` would put the same bytes on the wire and leave this at 0.
        expect(writes.count).toBe(1);
      });
    });

    test('a file body truncated after its length was captured fails the send', async () => {
      await withFixtureFile(TRUNCATED_FILE_BYTES, async path => {
        // The descriptor is built first, exactly as `fileBody()` captures `count` from `stat`, and
        // the file shrinks underneath it afterwards. `content-length` is dropped outbound, so the
        // wire cannot detect this either — BODY-13's check inside `writeTo` is the only thing that
        // can, and a transport that hands the path to its native client never runs it
        // (audit #67 / #81, where undici POSTed the ten surviving bytes and resolved 200).
        const body = fileBodyFixture(path, {count: TRUNCATED_FILE_BYTES});
        await truncate(path, TRUNCATED_TO_BYTES);
        const error = await withTransport(ctx.makeTransport, transport =>
          rejection(
            transport.send(
              Request.newBuilder()
                .method('POST')
                .url(ctx.isolatedUrl('/echo-body'))
                .body(body)
                .build(),
            ),
          ),
        );
        expect(error).toMatchObject({name: 'TransportFailureError'});
        expect(messageChain(error)).toContain(
          `transferred ${String(TRUNCATED_TO_BYTES)} of ${String(TRUNCATED_FILE_BYTES)} bytes`,
        );
      });
    });
  });
}

/**
 * The fixture's challenge list, recovered from however this transport chose to split it.
 *
 * Scoped to `/repeated-challenge` on purpose, and deliberately NOT a general RFC 7235 parser: the two
 * fixture challenges are `Digest`-schemed and carry no comma inside a quoted value, so a split at each
 * `, Digest ` boundary recovers exactly what the server wrote. `@dexpace/core`'s real parser is
 * `@internal` and unreachable from here — the core-side rows for it live in
 * `packages/core/src/auth/auth-step.test.ts`.
 */
function challengeList(values: readonly string[]): readonly string[] {
  return values.join(', ').split(/,\s+(?=Digest )/u);
}

function registerInboundHeaderRows(ctx: SuiteContext): void {
  describe('TRANSPORT-14, AUTH-12/AUTH-25: a repeated inbound header keeps every value', () => {
    test('two WWW-Authenticate lines reach the pipeline as the same challenge list', async () => {
      // The two transports split this differently and both are right: WHATWG `Headers` comma-joins
      // every name but `Set-Cookie`, so `@dexpace/transport-fetch` yields ONE `getAll` entry, while
      // undici arrays any repeated header and `@dexpace/transport-undici` yields TWO. RFC 9110 5.3
      // makes the two wire shapes equivalent, so the entry count is not what either adapter is
      // answerable for — the challenge list after the split is, and it must be identical.
      //
      // What this row guards is the loss: before audit #67 / #74 the auth step read
      // `headers.get(...)`, saw only the first line, and left a 401 offering an answerable SHA-256
      // challenge unanswered through undici while the identical offer authenticated through fetch.
      await withTransport(ctx.makeTransport, async transport => {
        const response = await transport.send(
          Request.newBuilder().url(ctx.url('/repeated-challenge')).build(),
        );
        expect(response.status.code).toBe(401);
        expect(
          challengeList(response.headers.getAll('WWW-Authenticate')),
        ).toEqual([...REPEATED_CHALLENGES]);
        await response.close();
      });
    });
  });
}

function registerDropSetRows(ctx: SuiteContext): void {
  describe('TRANSPORT-11/13: the transport-specific drop set', () => {
    test('the Connection header follows this transport’s documented drop set', async () => {
      // Asserted through the drop log, not the echoed request: both clients set a `Connection`
      // header of their own for connection management, so the wire cannot tell a forwarded
      // caller header from the client's own. The log is where the decision is observable
      // (TRANSPORT-11 with TRANSPORT-13).
      const dropped = await captureDroppedHeaders(async () => {
        await withTransport(ctx.makeTransport, async transport => {
          const request = Request.newBuilder()
            .url(ctx.url('/echo-headers'))
            .headers(
              Headers.newBuilder().set('Connection', 'keep-alive').build(),
            )
            .build();
          const response = await transport.send(request);
          await response.close();
        });
      });
      expect(dropped.includes('connection')).toBe(
        ctx.capabilities.dropsConnectionHeader,
      );
    });
  });
}

function registerScopedRows(ctx: SuiteContext): void {
  if (ctx.capabilities.supportsInternalCancel) {
    describe('TRANSPORT-8: an internal cancel is told apart from a timeout', () => {
      test('the same slow endpoint yields a terminal cancel and a retryable timeout', async () => {
        await withTransport(ctx.makeTransport, async transport => {
          const request = Request.newBuilder().url(ctx.url('/slow')).build();
          const controller = new AbortController();
          const cancelled = transport.send(
            request,
            undefined,
            controller.signal,
          );
          controller.abort();
          expect(await rejection(cancelled)).toMatchObject({
            name: 'CancellationError',
          });
          const timedOut = transport.send(
            Request.newBuilder().url(ctx.url('/slow')).build(),
            RequestOptions.newBuilder().timeoutMs(30).build(),
          );
          expect(await rejection(timedOut)).toMatchObject({
            name: 'TransportFailureError',
          });
        });
      });
    });
  }

  if (ctx.capabilities.supportsProxy) {
    describe('TRANSPORT-30: proxy-capable, but only when asked', () => {
      test('an unconfigured proxy-capable transport still routes normally', async () => {
        // §17's own conformance line for TRANSPORT-30 ("assert normal requests still route").
        // The regression it guards is a transport that installs a proxy dispatcher unconditionally
        // and tunnels every request through nothing.
        await withTransport(ctx.makeTransport, async transport => {
          const response = await transport.send(
            Request.newBuilder().url(ctx.url('/echo-headers')).build(),
          );
          expect(response.status.code).toBe(200);
          await response.close();
        });
      });
    });
  }
}

/**
 * Registers the whole `TRANSPORT-N` conformance suite against one transport factory.
 *
 * @param name - the transport's name, used as the outer `describe` label.
 * @param makeTransport - builds a fresh transport; called once per row and closed by the suite.
 * @param capabilities - the clauses §17 scopes to a subset of transports.
 */
export function runTransportConformanceSuite(
  name: string,
  makeTransport: () => Transport,
  capabilities: TransportCapabilities,
): void {
  describe(`${name} conformance (TRANSPORT-1..30, SEAM-12/16/30, NFR-15)`, () => {
    let server: TestServer;
    let isolated: TestServer;
    beforeAll(async () => {
      server = await startFixtureServer();
      isolated = await startFixtureServer();
    });
    afterAll(async () => {
      await server.close();
      await isolated.close();
    });

    const ctx: SuiteContext = {
      makeTransport,
      capabilities,
      url: path => `${server.url}${path}`,
      isolatedUrl: path => `${isolated.url}${path}`,
    };
    registerDispatchRows(ctx);
    registerStatusRows(ctx);
    registerBodyRows(ctx);
    registerProducerRows(ctx);
    registerFailureRows(ctx);
    registerCancellationRows(ctx);
    registerLifecycleRows(ctx);
    registerHeaderRows(ctx);
    registerNativeRejectionRows(ctx);
    registerFileBodyRows(ctx);
    registerInboundHeaderRows(ctx);
    registerDropSetRows(ctx);
    registerScopedRows(ctx);
  });
}
