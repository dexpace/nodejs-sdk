// SPDX-License-Identifier: MIT
// packages/core/src/pipeline/builder.test.ts
// Exercises: PIPE-4/5/6 (a pillar admits at most one step; a distinct collision throws; the same type is
// idempotent), PIPE-7 (non-pillar stages preserve insertion order through append/prepend), PIPE-8 (SEND
// rejects any insertion), PIPE-18/19 (insertAfter/insertBefore/replace act relative to the first anchor
// instance; cross-stage is rejected), PIPE-20 (remove deletes every instance, no-op when absent), PIPE-21
// (a missing anchor fails), PIPE-22 (an edit sequence flattens the same as constructing the final set from
// scratch), PIPE-23 (a colliding reload leaves prior content untouched, and a same-type pillar repeat inside
// one batch seats only one step), PIPE-25 (flatten order), PIPE-38 (appendAll preserves batch order;
// prependAll reverses it), PIPE-1/PIPE-2 (a built pipeline, driven: entry in STAGE_ORDER, exit reversed),
// PIPE-35 (seedFrom's explicit, non-defaulted flatten-vs-nest modes), OBS-29 + CTX-16 (the public
// instrumentation options bag: the supplied bundle opens the operation span, the operation name reaches
// the request context, and flatten seeding carries both)
import {describe, expect, test} from 'bun:test';
import fc from 'fast-check';
import {Protocol} from '../http/protocol.js';
import {Request} from '../http/request.js';
import {Response} from '../http/response.js';
import {Status} from '../http/status.js';
import {
  createInstrumentationBundle,
  type Span,
  type Tracer,
} from '../observability/tracing.js';
import type {Transport} from '../seams/transport.js';
import {PipelineBuilder} from './builder.js';
import {
  AnchorNotFoundError,
  CrossStageEditError,
  PillarCollisionError,
  ReservedStageError,
} from './errors.js';
import type {Runtime} from './runtime.js';
import {PILLAR_STAGES, STAGE_ORDER, type Stage} from './stage.js';
import type {Step, StepDescriptor} from './step.js';

function aRequest(url: string): Request {
  return Request.newBuilder().url(url).build();
}

function aResponse(status: number): Response {
  return Response.newBuilder()
    .request(aRequest('https://example.com'))
    .protocol(Protocol.HTTP_1_1)
    .status(Status.of(status))
    .build();
}

class StubTransport implements Transport {
  #response: Response;

  constructor(response: Response) {
    this.#response = response;
  }

  send(): Promise<Response> {
    return Promise.resolve(this.#response);
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

// A driven pipeline installs a context per call and evicts it again in `Runtime.send()`'s own `finally`, so
// this file leaves the process-wide `contextStore` exactly as it found it -- no `afterEach(clear)`, which
// would wipe entries a sibling test file installed (4a's plan Global Constraints; testing.md:50,52).

const noopStep: Step = async (_request, ctx) => ctx.next();

function descriptor(
  label: string,
  stage: StepDescriptor['stage'],
): StepDescriptor {
  return {type: Symbol(label), stage, fn: noopStep};
}

function labelsOf(runtime: Runtime): (string | undefined)[] {
  return runtime.steps.map(d => d.type.description);
}

function aBuilder(): PipelineBuilder {
  return new PipelineBuilder(new StubTransport(aResponse(200)));
}

describe('PipelineBuilder pillar rules (PIPE-4, PIPE-5, PIPE-6)', () => {
  test('a pillar stage admits at most one step', () => {
    const builder = aBuilder().append(descriptor('a', 'RETRY'));

    expect(builder.build().steps).toHaveLength(1);
  });

  test('installing a distinct second step onto an occupied pillar throws, naming both types', () => {
    const builder = aBuilder();
    const a = descriptor('a', 'RETRY');
    const b = descriptor('b', 'RETRY');
    builder.append(a);

    try {
      builder.append(b);
      throw new Error(
        'unreachable -- append must throw for a distinct pillar collision',
      );
    } catch (error) {
      expect(error).toBeInstanceOf(PillarCollisionError);
      expect((error as PillarCollisionError).existingType).toBe(a.type);
      expect((error as PillarCollisionError).incomingType).toBe(b.type);
    }
  });

  test('re-installing the identical descriptor type onto its own pillar is an idempotent no-op', () => {
    const builder = aBuilder();
    const a = descriptor('a', 'RETRY');

    builder.append(a).append(a);

    expect(builder.build().steps).toHaveLength(1);
  });
});

describe('PipelineBuilder remove then re-install (PIPE-20, PIPE-5)', () => {
  test('a pillar emptied by remove accepts a step of a different type', () => {
    const first = descriptor('first', 'RETRY');
    const builder = aBuilder().append(first);

    builder.remove(first.type);
    builder.append(descriptor('second', 'RETRY'));

    // The emptied bucket must not read as still occupied: PIPE-5's collision is about an occupant, and
    // remove left none.
    expect(labelsOf(builder.build())).toEqual(['second']);
  });
});

describe('PipelineBuilder non-pillar ordering (PIPE-7)', () => {
  test('append adds to the tail, prepend adds to the head, within one stage', () => {
    const a = descriptor('a', 'PRE_LOGGING');
    const b = descriptor('b', 'PRE_LOGGING');
    const c = descriptor('c', 'PRE_LOGGING');

    const runtime = aBuilder().append(a).append(c).prepend(b).build();

    expect(labelsOf(runtime)).toEqual(['b', 'a', 'c']);
  });
});

describe('PipelineBuilder batch edits (PIPE-38)', () => {
  test('appendAll preserves the batch iteration order', () => {
    const steps = ['a', 'b', 'c'].map(label =>
      descriptor(label, 'PRE_LOGGING'),
    );

    const runtime = aBuilder().appendAll(steps).build();

    expect(labelsOf(runtime)).toEqual(['a', 'b', 'c']);
  });

  test('prependAll results in the reversed batch order', () => {
    const steps = ['a', 'b', 'c'].map(label =>
      descriptor(label, 'PRE_LOGGING'),
    );

    const runtime = aBuilder().prependAll(steps).build();

    expect(labelsOf(runtime)).toEqual(['c', 'b', 'a']);
  });
});

describe('PipelineBuilder anchor edits (PIPE-18, PIPE-19, PIPE-21)', () => {
  test('insertAfter/insertBefore act relative to the FIRST existing instance of the anchor type', () => {
    const a = descriptor('a', 'PRE_LOGGING');
    const b = descriptor('b', 'PRE_LOGGING');
    const builder = aBuilder().append(a).append(b);

    builder.insertAfter(a.type, descriptor('c', 'PRE_LOGGING'));
    builder.insertBefore(a.type, descriptor('d', 'PRE_LOGGING'));

    expect(labelsOf(builder.build())).toEqual(['d', 'a', 'c', 'b']);
  });

  test('insertAfter/insertBefore/replace reject a cross-stage edit', () => {
    const a = descriptor('a', 'PRE_LOGGING');
    const builder = aBuilder().append(a);
    const wrongStage = descriptor('x', 'POST_LOGGING');

    expect(() => builder.insertAfter(a.type, wrongStage)).toThrow(
      CrossStageEditError,
    );
    expect(() => builder.insertBefore(a.type, wrongStage)).toThrow(
      CrossStageEditError,
    );
    expect(() => builder.replace(a.type, wrongStage)).toThrow(
      CrossStageEditError,
    );
  });

  test('an anchor edit against a missing type throws AnchorNotFoundError', () => {
    const builder = aBuilder();
    const missing = Symbol('missing');

    expect(() =>
      builder.insertAfter(missing, descriptor('x', 'PRE_LOGGING')),
    ).toThrow(AnchorNotFoundError);
    expect(() =>
      builder.replace(missing, descriptor('x', 'PRE_LOGGING')),
    ).toThrow(AnchorNotFoundError);
  });

  test('replace swaps the anchor step in place, same stage, same position', () => {
    const a = descriptor('a', 'PRE_LOGGING');
    const b = descriptor('b', 'PRE_LOGGING');
    const builder = aBuilder().append(a).append(b);

    builder.replace(a.type, descriptor('a2', 'PRE_LOGGING'));

    expect(labelsOf(builder.build())).toEqual(['a2', 'b']);
  });
});

describe('PipelineBuilder remove (PIPE-20)', () => {
  test('deletes every instance of a type, preserving relative order of the rest', () => {
    const a1 = descriptor('a', 'PRE_LOGGING');
    const b = descriptor('b', 'PRE_LOGGING');
    const a2: StepDescriptor = {
      type: a1.type,
      stage: 'POST_LOGGING',
      fn: noopStep,
    };
    const builder = aBuilder().appendAll([a1, b]).append(a2);

    builder.remove(a1.type);

    expect(labelsOf(builder.build())).toEqual(['b']);
  });

  test('is a no-op when the type is absent', () => {
    const a = descriptor('a', 'PRE_LOGGING');
    const builder = aBuilder().append(a);

    expect(() => builder.remove(Symbol('absent'))).not.toThrow();
    expect(labelsOf(builder.build())).toEqual(['a']);
  });
});

describe('PipelineBuilder reload (PIPE-23)', () => {
  test('a colliding batch leaves the existing collection completely unchanged', () => {
    const builder = aBuilder().append(descriptor('original', 'PRE_LOGGING'));

    expect(() =>
      builder.reload([descriptor('x', 'RETRY'), descriptor('y', 'RETRY')]),
    ).toThrow(PillarCollisionError);
    expect(labelsOf(builder.build())).toEqual(['original']);
  });

  test('a valid batch fully replaces the prior collection', () => {
    const builder = aBuilder().append(descriptor('stale', 'PRE_LOGGING'));

    builder.reload([descriptor('fresh', 'POST_LOGGING')]);

    expect(labelsOf(builder.build())).toEqual(['fresh']);
  });

  test('a batch rejected on a later element leaves the existing collection untouched', () => {
    const builder = aBuilder().append(descriptor('original', 'PRE_LOGGING'));

    expect(() =>
      builder.reload([descriptor('ok', 'PRE_AUTH'), descriptor('bad', 'SEND')]),
    ).toThrow(ReservedStageError);

    // PIPE-23: validation runs over the whole batch before `#buckets.clear()`, so a rejection that
    // surfaces on the second element cannot leave the builder half-rebuilt.
    expect(labelsOf(builder.build())).toEqual(['original']);
  });

  test('a batch repeating the SAME pillar type installs it once, not twice (PIPE-4, PIPE-6)', () => {
    const retry = descriptor('retry', 'RETRY');
    const builder = aBuilder();

    builder.reload([retry, retry]);

    // PIPE-4: a pillar admits at most one step. The incremental `append` path already treats a same-type
    // re-install as an idempotent no-op (PIPE-6); a bulk reload must not be the back door that seats two.
    expect(labelsOf(builder.build())).toEqual(['retry']);
  });
});

describe('PipelineBuilder reserved SEND stage (PIPE-8)', () => {
  test('rejects any insertion targeting SEND', () => {
    const sendShaped = descriptor('x', 'SEND');

    expect(() => aBuilder().append(sendShaped)).toThrow(ReservedStageError);
    expect(() => aBuilder().prepend(sendShaped)).toThrow(ReservedStageError);
    expect(() => aBuilder().reload([sendShaped])).toThrow(ReservedStageError);
  });
});

describe('PipelineBuilder.build() flatten order (PIPE-1, PIPE-25)', () => {
  test('flattens stages in declaration order regardless of append order', () => {
    const preRedirect = descriptor('pre-redirect', 'PRE_REDIRECT');
    const postSerde = descriptor('post-serde', 'POST_SERDE');

    const runtime = aBuilder().append(postSerde).append(preRedirect).build();

    expect(labelsOf(runtime)).toEqual(['pre-redirect', 'post-serde']);
  });

  // PIPE-1/PIPE-2's conformance clause, in the one place that can express it: a built pipeline actually
  // driven. Entry is the stage list top-down, exit is its exact reverse, with insertion order deliberately
  // the reverse of declaration order so a flatten that leaked insertion order would fail loudly.
  test('one probe step per stage enters in STAGE_ORDER and exits in its exact reverse', async () => {
    const stages = STAGE_ORDER.filter(stage => stage !== 'SEND');
    const log: string[] = [];
    const builder = aBuilder();
    for (const stage of [...stages].reverse()) {
      builder.append({
        type: Symbol(stage),
        stage,
        fn: async (_request, ctx) => {
          log.push(`enter:${stage}`);
          const response = await ctx.next();
          log.push(`exit:${stage}`);
          return response;
        },
      });
    }

    await builder.build().send(aRequest('https://example.com'));

    expect(log).toEqual([
      ...stages.map(stage => `enter:${stage}`),
      ...[...stages].reverse().map(stage => `exit:${stage}`),
    ]);
  });
});

describe('PipelineBuilder edit-order independence (PIPE-22)', () => {
  test('an edit sequence flattens the same as constructing the final set from scratch', () => {
    const a = descriptor('a', 'PRE_LOGGING');
    const b = descriptor('b', 'PRE_LOGGING');
    const c = descriptor('c', 'POST_LOGGING');

    const edited = new PipelineBuilder(new StubTransport(aResponse(200)))
      .append(a)
      .append(c)
      .prepend(b)
      .build();
    const fromScratch = new PipelineBuilder(new StubTransport(aResponse(200)))
      .appendAll([b, a, c])
      .build();

    expect(labelsOf(edited)).toEqual(labelsOf(fromScratch));
    expect(labelsOf(edited)).toEqual(['b', 'a', 'c']);
  });
});

// The two ordering laws the design calls for (PIPE-38's split across an append and a prepend test, one act
// each). `build()` is an invariant-bearing assembler, which
// docs/knowledge/harvested/testing.md:29 puts in property-test territory; the examples above pin concrete regressions,
// these prove the law over generated input. Generated over the non-pillar stages only: a generator that also
// emitted pillar stages would spend most of its cases hitting PIPE-5's collision instead of exercising order.
const editableStages = STAGE_ORDER.filter(
  stage => stage !== 'SEND' && !PILLAR_STAGES.has(stage),
);

describe('PipelineBuilder ordering properties (PIPE-22)', () => {
  test('any append/prepend sequence flattens the same as building the final set from scratch (PIPE-22)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            stage: fc.constantFrom(...editableStages),
            where: fc.constantFrom('append' as const, 'prepend' as const),
          }),
          {maxLength: 24},
        ),
        edits => {
          const edited = aBuilder();
          const model = new Map<Stage, StepDescriptor[]>();
          for (const [index, edit] of edits.entries()) {
            const step = descriptor(`s${String(index)}`, edit.stage);
            const bucket = model.get(edit.stage) ?? [];
            if (edit.where === 'append') {
              bucket.push(step);
              edited.append(step);
            } else {
              bucket.unshift(step);
              edited.prepend(step);
            }
            model.set(edit.stage, bucket);
          }
          const finalSet = editableStages.flatMap(
            stage => model.get(stage) ?? [],
          );

          const fromScratch = aBuilder().appendAll(finalSet).build();

          expect(labelsOf(edited.build())).toEqual(labelsOf(fromScratch));
        },
      ),
    );
  });
});

describe('PipelineBuilder batch-order properties (PIPE-38)', () => {
  test('appendAll preserves the batch order within a stage, for a batch of any size (PIPE-38)', () => {
    fc.assert(
      fc.property(
        fc.integer({min: 1, max: 12}),
        fc.constantFrom(...editableStages),
        (size, stage) => {
          const batch = Array.from({length: size}, (_unused, index) =>
            descriptor(`s${String(index)}`, stage),
          );

          const runtime = aBuilder().appendAll(batch).build();

          expect(labelsOf(runtime)).toEqual(
            batch.map(step => step.type.description),
          );
        },
      ),
    );
  });

  test('prependAll reverses the batch order within a stage, for a batch of any size (PIPE-38)', () => {
    fc.assert(
      fc.property(
        fc.integer({min: 1, max: 12}),
        fc.constantFrom(...editableStages),
        (size, stage) => {
          const batch = Array.from({length: size}, (_unused, index) =>
            descriptor(`s${String(index)}`, stage),
          );

          const runtime = aBuilder().prependAll(batch).build();

          expect(labelsOf(runtime)).toEqual(
            batch.map(step => step.type.description).reverse(),
          );
        },
      ),
    );
  });
});

// Module-scope, not describe-local: the seedFrom suite is split across sibling describes to stay
// inside `max-lines-per-function`, and both halves need these.
class RecordingTransport implements Transport {
  readonly calls: Request[] = [];

  send(request: Request): Promise<Response> {
    this.calls.push(request);
    return Promise.resolve(aResponse(200));
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

function probeStep(
  label: string,
  stage: StepDescriptor['stage'],
  order: string[],
): StepDescriptor {
  return {
    type: Symbol(label),
    stage,
    // A plain pass-through probe never re-drives, so `next()` suffices -- no fork needed.
    fn: async (request, ctx) => {
      order.push(label);
      return ctx.next(request);
    },
  };
}

describe('PipelineBuilder.seedFrom (PIPE-35)', () => {
  test('flatten: seeded steps run in the SAME pass as newly appended ones, reusing the original transport', async () => {
    const transport = new RecordingTransport();
    const order: string[] = [];
    const seeded = new PipelineBuilder(transport)
      .append(probeStep('seeded', 'LOGGING', order))
      .build();

    const runtime = PipelineBuilder.seedFrom(seeded, 'flatten')
      .append(probeStep('appended', 'SERDE', order))
      .build();

    await runtime.send(aRequest('https://example.com'));

    expect(order).toEqual(['seeded', 'appended']); // one combined STAGE_ORDER pass
    // The ORIGINAL transport is the terminal -- `seeded` itself is not in the chain.
    expect(transport.calls).toHaveLength(1);
  });

  test('flatten: re-buckets each descriptor by its OWN stage, not by seeded array position', () => {
    const transport = new RecordingTransport();
    const order: string[] = [];
    const seeded = new PipelineBuilder(transport)
      .append(probeStep('late', 'SERDE', order))
      .append(probeStep('early', 'PRE_REDIRECT', order))
      .build();

    const runtime = PipelineBuilder.seedFrom(seeded, 'flatten').build();

    expect(labelsOf(runtime)).toEqual(['early', 'late']);
  });

  test('flatten: pillar-collision rules apply exactly as any other append sequence', () => {
    const transport = new RecordingTransport();
    const seeded = new PipelineBuilder(transport)
      .append(descriptor('retry-a', 'RETRY'))
      .build();

    expect(() =>
      PipelineBuilder.seedFrom(seeded, 'flatten').append(
        descriptor('retry-b', 'RETRY'),
      ),
    ).toThrow(PillarCollisionError);
  });
});

describe('PipelineBuilder.seedFrom nest mode (PIPE-35)', () => {
  test('nest: the seeded runtime is an opaque Transport -- its steps run in a separate, inner pass', async () => {
    const transport = new RecordingTransport();
    const order: string[] = [];
    const seeded = new PipelineBuilder(transport)
      .append(probeStep('inner', 'LOGGING', order))
      .build();

    const runtime = PipelineBuilder.seedFrom(seeded, 'nest')
      .append(probeStep('outer', 'LOGGING', order))
      .build();

    await runtime.send(aRequest('https://example.com'));

    expect(order).toEqual(['outer', 'inner']); // the outer step runs BEFORE the nested runtime's
    expect(transport.calls).toHaveLength(1); // still exactly one wire send at the bottom
  });

  test('nest: the same pillar may be occupied in BOTH layers -- they are separate builders', () => {
    const transport = new RecordingTransport();
    const seeded = new PipelineBuilder(transport)
      .append(descriptor('retry-inner', 'RETRY'))
      .build();

    const runtime = PipelineBuilder.seedFrom(seeded, 'nest')
      .append(descriptor('retry-outer', 'RETRY'))
      .build();

    expect(labelsOf(runtime)).toEqual(['retry-outer']);
    expect(runtime.transport).toBe(seeded);
  });
});

/** Records the name of every span it is asked to open, so a test can count operations. */
function countingTracer(): {tracer: Tracer; names: string[]} {
  const names: string[] = [];
  const span: Span = {
    isRecording: true,
    setAttribute: (): Span => span,
    recordException: (): Span => span,
    end: (): void => undefined,
  };
  return {
    names,
    tracer: {
      startSpan(name: string): Span {
        names.push(name);
        return span;
      },
    },
  };
}

/** Captures what the drive's `RequestContext` says, from inside the pipeline. */
function contextProbe(seen: {
  operationName?: string | undefined;
}): StepDescriptor {
  return {
    type: Symbol('context-probe'),
    stage: 'PRE_SERDE',
    fn: async (request, ctx) => {
      seen.operationName =
        'operationName' in ctx.context ? ctx.context.operationName : undefined;
      return ctx.next(request);
    },
  };
}

describe('PipelineBuilder instrumentation options (OBS-29, CTX-16)', () => {
  test('the supplied bundle is what opens the per-operation span', async () => {
    const {tracer, names} = countingTracer();
    const runtime = new PipelineBuilder(new RecordingTransport(), {
      instrumentation: createInstrumentationBundle(() => tracer),
    })
      .append(descriptor('probe', 'PRE_SERDE'))
      .build();

    await runtime.send(aRequest('https://example.com'));
    await runtime.send(aRequest('https://example.com'));

    expect(names).toEqual(['http.client.operation', 'http.client.operation']);
  });

  test('operationName reaches the request context every step reads (CTX-16)', async () => {
    const seen: {operationName?: string | undefined} = {};
    const runtime = new PipelineBuilder(new RecordingTransport(), {
      operationName: 'GetUser',
    })
      .append(contextProbe(seen))
      .build();

    await runtime.send(aRequest('https://example.com'));

    expect(seen.operationName).toBe('GetUser');
  });

  test('no options bag means the no-op bundle and no operation name', async () => {
    const seen: {operationName?: string | undefined} = {};
    const runtime = new PipelineBuilder(new RecordingTransport())
      .append(contextProbe(seen))
      .build();

    await runtime.send(aRequest('https://example.com'));

    expect(seen.operationName).toBeUndefined();
  });

  test('flatten seeding carries the seed runtime’s options (PIPE-35)', async () => {
    const {tracer, names} = countingTracer();
    const seen: {operationName?: string | undefined} = {};
    const seeded = new PipelineBuilder(new RecordingTransport(), {
      instrumentation: createInstrumentationBundle(() => tracer),
      operationName: 'GetUser',
    })
      .append(descriptor('seeded', 'LOGGING'))
      .build();

    const runtime = PipelineBuilder.seedFrom(seeded, 'flatten')
      .append(contextProbe(seen))
      .build();

    await runtime.send(aRequest('https://example.com'));

    expect(names).toEqual(['http.client.operation']);
    expect(seen.operationName).toBe('GetUser');
  });
});
