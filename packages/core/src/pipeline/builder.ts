// SPDX-License-Identifier: MIT
// packages/core/src/pipeline/builder.ts
import {invariant} from '../invariant.js';
import type {Transport} from '../seams/transport.js';
import {
  AnchorNotFoundError,
  CrossStageEditError,
  PillarCollisionError,
  ReservedStageError,
} from './errors.js';
import {createRuntime, type Runtime} from './runtime.js';
import {PILLAR_STAGES, STAGE_ORDER, type Stage} from './stage.js';
import type {StepDescriptor} from './step.js';

interface AnchorLocation {
  readonly stage: Stage;
  readonly index: number;
}

/**
 * Assembles a stage-based pipeline via surgical edits (PIPE-7, PIPE-18..PIPE-24), flattening into an
 * immutable Runtime at build() time (PIPE-25). Mutable while being built; the produced Runtime is frozen.
 *
 * @public
 */
export class PipelineBuilder {
  readonly #buckets = new Map<Stage, StepDescriptor[]>();
  readonly #transport: Transport;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  /**
   * Seats `descriptor` at the tail of its own stage bucket (PIPE-7).
   *
   * @throws ReservedStageError when the descriptor declares the terminal `SEND` stage (PIPE-8).
   * @throws PillarCollisionError when its pillar stage already holds a step of a different type
   *   (PIPE-5); re-seating the same `type` symbol is an idempotent no-op instead (PIPE-6).
   */
  append(descriptor: StepDescriptor): this {
    this.#rejectReservedStage(descriptor.stage, 'append');
    if (this.#pillarSlot(descriptor) === 'occupied-same-type') return this;
    this.#insertAt(descriptor.stage, descriptor, 'tail');
    return this;
  }

  /**
   * Seats `descriptor` at the head of its own stage bucket (PIPE-7).
   *
   * @throws ReservedStageError when the descriptor declares the terminal `SEND` stage (PIPE-8).
   * @throws PillarCollisionError when its pillar stage already holds a step of a different type
   *   (PIPE-5); re-seating the same `type` symbol is an idempotent no-op instead (PIPE-6).
   */
  prepend(descriptor: StepDescriptor): this {
    this.#rejectReservedStage(descriptor.stage, 'prepend');
    if (this.#pillarSlot(descriptor) === 'occupied-same-type') return this;
    this.#insertAt(descriptor.stage, descriptor, 'head');
    return this;
  }

  /**
   * PIPE-38: batch iteration order preserved within a stage.
   *
   * @throws ReservedStageError as {@link PipelineBuilder.append}, on the first offending descriptor.
   * @throws PillarCollisionError as {@link PipelineBuilder.append}. Not all-or-nothing: descriptors
   *   before the offending one are already seated — `reload` is the transactional bulk path (PIPE-23).
   */
  appendAll(descriptors: readonly StepDescriptor[]): this {
    for (const descriptor of descriptors) this.append(descriptor);
    return this;
  }

  /**
   * PIPE-38: each element prepended individually -- the batch order comes out reversed, by
   * construction. This asymmetry with {@link PipelineBuilder.appendAll} is the documented one PIPE-38
   * requires a port to state.
   *
   * @throws ReservedStageError as {@link PipelineBuilder.prepend}, on the first offending descriptor.
   * @throws PillarCollisionError as {@link PipelineBuilder.prepend}. Not all-or-nothing, as above.
   */
  prependAll(descriptors: readonly StepDescriptor[]): this {
    for (const descriptor of descriptors) this.prepend(descriptor);
    return this;
  }

  /**
   * Seats `descriptor` immediately after the first existing instance of `anchorType` (PIPE-18).
   *
   * @throws ReservedStageError when the descriptor declares the terminal `SEND` stage (PIPE-8).
   * @throws AnchorNotFoundError when no step of `anchorType` is present (PIPE-21).
   * @throws CrossStageEditError when the descriptor's stage differs from the anchor's (PIPE-18).
   * @throws PillarCollisionError when the anchor's pillar stage already holds a different type (PIPE-5).
   */
  insertAfter(anchorType: symbol, descriptor: StepDescriptor): this {
    this.#rejectReservedStage(descriptor.stage, 'insertAfter');
    const anchor = this.#requireAnchor(anchorType, 'insertAfter');
    this.#requireSameStage(anchor.stage, descriptor.stage);
    if (this.#pillarSlot(descriptor) === 'occupied-same-type') return this;
    const bucket = this.#requireAnchorBucket(anchor);
    bucket.splice(anchor.index + 1, 0, descriptor);
    return this;
  }

  /**
   * Seats `descriptor` immediately before the first existing instance of `anchorType` (PIPE-18).
   *
   * @throws ReservedStageError when the descriptor declares the terminal `SEND` stage (PIPE-8).
   * @throws AnchorNotFoundError when no step of `anchorType` is present (PIPE-21).
   * @throws CrossStageEditError when the descriptor's stage differs from the anchor's (PIPE-18).
   * @throws PillarCollisionError when the anchor's pillar stage already holds a different type (PIPE-5).
   */
  insertBefore(anchorType: symbol, descriptor: StepDescriptor): this {
    this.#rejectReservedStage(descriptor.stage, 'insertBefore');
    const anchor = this.#requireAnchor(anchorType, 'insertBefore');
    this.#requireSameStage(anchor.stage, descriptor.stage);
    if (this.#pillarSlot(descriptor) === 'occupied-same-type') return this;
    const bucket = this.#requireAnchorBucket(anchor);
    bucket.splice(anchor.index, 0, descriptor);
    return this;
  }

  /**
   * Swaps the first existing instance of `anchorType` for `descriptor`, in place (PIPE-19). The
   * sanctioned way past a pillar collision: PIPE-5 exempts `replace` from the pillar check, since it
   * swaps one occupant 1:1 within its own stage and the incoming type is distinct by definition.
   *
   * @throws ReservedStageError when the descriptor declares the terminal `SEND` stage (PIPE-8).
   * @throws AnchorNotFoundError when no step of `anchorType` is present (PIPE-21).
   * @throws CrossStageEditError when the descriptor's stage differs from the anchor's (PIPE-19).
   */
  replace(anchorType: symbol, descriptor: StepDescriptor): this {
    this.#rejectReservedStage(descriptor.stage, 'replace');
    const anchor = this.#requireAnchor(anchorType, 'replace');
    this.#requireSameStage(anchor.stage, descriptor.stage);
    const bucket = this.#requireAnchorBucket(anchor);
    bucket.splice(anchor.index, 1, descriptor);
    return this;
  }

  /**
   * PIPE-20: deletes every instance of `type`, preserving relative order; a no-op when absent. A stage
   * left with no steps keeps an empty bucket, which flattening and the pillar check both read as absent.
   */
  remove(type: symbol): this {
    for (const [stage, bucket] of this.#buckets) {
      const filtered = bucket.filter(entry => entry.type !== type);
      if (filtered.length !== bucket.length) this.#buckets.set(stage, filtered);
    }
    return this;
  }

  /**
   * PIPE-23: all-or-nothing -- validated fully before any existing content is touched, so a rejected
   * batch leaves the builder exactly as it was.
   *
   * @throws ReservedStageError when any descriptor declares the terminal `SEND` stage (PIPE-8).
   * @throws PillarCollisionError when two descriptors of different types claim one pillar stage
   *   (PIPE-5); a repeat of the same `type` on one pillar is dropped instead, so the bulk path cannot
   *   seat two steps where `append` would seat one (PIPE-4/PIPE-6).
   */
  reload(descriptors: readonly StepDescriptor[]): this {
    const admitted: StepDescriptor[] = [];
    const pillarTypes = new Map<Stage, symbol>();
    for (const descriptor of descriptors) {
      this.#rejectReservedStage(descriptor.stage, 'reload');
      if (!PILLAR_STAGES.has(descriptor.stage)) {
        admitted.push(descriptor);
        continue;
      }
      const seenType = pillarTypes.get(descriptor.stage);
      // PIPE-6: a repeat of the SAME type is idempotent, not a second step.
      if (seenType === descriptor.type) continue;
      if (seenType !== undefined) {
        throw new PillarCollisionError(
          descriptor.stage,
          seenType,
          descriptor.type,
        ); // PIPE-5
      }
      pillarTypes.set(descriptor.stage, descriptor.type);
      admitted.push(descriptor);
    }
    // PIPE-4: `admitted` holds at most one entry per pillar stage by construction -- a same-type repeat was
    // skipped above rather than pushed, so a batch cannot install two steps onto one pillar the way the
    // incremental `append` path already refuses to.
    this.#buckets.clear();
    for (const descriptor of admitted) {
      const bucket = this.#buckets.get(descriptor.stage);
      if (bucket === undefined)
        this.#buckets.set(descriptor.stage, [descriptor]);
      else bucket.push(descriptor);
    }
    return this;
  }

  /**
   * PIPE-35: derives a builder from an already-built `runtime`, under an explicit, non-defaulted
   * `mode` — the requirement's own MUST is that the flatten-vs-nest choice be explicit, never
   * accidental, so there is deliberately no default value.
   *
   * `flatten` re-buckets every seeded descriptor by its own stage and reuses `runtime`'s transport as
   * the new builder's terminal, so seeded and newly-appended steps run in the SAME cursor pass.
   * Pillar-collision rules apply exactly as they would to any other `append` sequence, because
   * flatten IS an append sequence.
   *
   * Seeding re-seats the SAME descriptor objects, never copies: a `StepDescriptor` is a plain record
   * around a closure, so any state that closure captured is now shared between `runtime` and the
   * builder derived from it. `authStep`'s `BearerTokenCache` is the live example — a flattened
   * builder shares one token cache, and therefore one single-flight slot, with the runtime it was
   * seeded from. That is usually what a caller wants (AUTH-34's coalescing only works when concurrent
   * calls meet at one instance), but it is sharing, not isolation; a caller who needs an independent
   * cache constructs a fresh `authStep`.
   *
   * `nest` constructs a fresh builder whose transport IS `runtime`, treated as an opaque `Transport`
   * — `Runtime implements Transport` (PIPE-26) makes this work with zero adapter code — so the new
   * builder's own steps run once, outside `runtime`'s already-flattened loops.
   *
   * @param runtime - the built pipeline to seed from.
   * @param mode - `'flatten'` to merge its steps into this builder's stages, `'nest'` to wrap it as
   *   this builder's transport.
   * @returns a fresh builder seeded per `mode`.
   * @throws PillarCollisionError in `'flatten'` mode when two seeded descriptors of different types
   *   claim one pillar stage (PIPE-5) — the same rule `append` enforces.
   */
  static seedFrom(runtime: Runtime, mode: 'flatten' | 'nest'): PipelineBuilder {
    if (mode === 'flatten') {
      return new PipelineBuilder(runtime.transport).appendAll(runtime.steps);
    }
    return new PipelineBuilder(runtime);
  }

  /** PIPE-25: flattens stage buckets in declaration order, skipping SEND, into an immutable Runtime. */
  build(): Runtime {
    const flattened: StepDescriptor[] = [];
    for (const stage of STAGE_ORDER) {
      if (stage === 'SEND') continue; // PIPE-8: terminal, reserved, flattening skips it.
      const bucket = this.#buckets.get(stage);
      if (bucket !== undefined) flattened.push(...bucket);
    }
    return createRuntime(flattened, this.#transport); // Runtime copies and freezes -- PIPE-10/PIPE-25.
  }

  #rejectReservedStage(stage: Stage, operation: string): void {
    if (stage === 'SEND') throw new ReservedStageError(operation); // PIPE-8
  }

  /**
   * PIPE-4/5/6: `'ok'` when `descriptor` may be seated, `'occupied-same-type'` when its pillar already
   * holds that exact `type` and the edit is an idempotent no-op. A bucket emptied by `remove` counts as
   * unoccupied.
   *
   * @throws PillarCollisionError when the pillar holds a step of a different type (PIPE-5).
   */
  #pillarSlot(descriptor: StepDescriptor): 'ok' | 'occupied-same-type' {
    const {stage, type} = descriptor;
    if (!PILLAR_STAGES.has(stage)) return 'ok';
    const bucket = this.#buckets.get(stage);
    if (bucket === undefined || bucket.length === 0) return 'ok';
    const occupant = bucket[0];
    invariant(
      occupant !== undefined,
      'pillar bucket has non-zero length but its first element is undefined',
    );
    if (occupant.type === type) return 'occupied-same-type'; // PIPE-6: idempotent re-installation.
    throw new PillarCollisionError(stage, occupant.type, type); // PIPE-5
  }

  #insertAt(
    stage: Stage,
    descriptor: StepDescriptor,
    where: 'head' | 'tail',
  ): void {
    const bucket = this.#buckets.get(stage);
    if (bucket === undefined) {
      this.#buckets.set(stage, [descriptor]);
      return;
    }
    if (where === 'tail') bucket.push(descriptor);
    else bucket.unshift(descriptor);
  }

  /**
   * PIPE-18's "first existing instance", resolved in flattened order -- `STAGE_ORDER` first, then
   * position within the stage bucket. A type installed in more than one stage therefore anchors on its
   * earliest-staged instance, and an edit declaring one of the later stages is a cross-stage edit even
   * though an instance does sit in that stage.
   */
  /**
   * The bucket `anchor` was found in. `#requireAnchor` has already located an entry there, so the
   * absence of the bucket would be an internal inconsistency rather than a caller error — which is
   * what the invariant says, once, instead of three times.
   */
  #requireAnchorBucket(anchor: {stage: Stage}): StepDescriptor[] {
    const bucket = this.#buckets.get(anchor.stage);
    invariant(
      bucket !== undefined,
      'anchor stage bucket must exist -- #requireAnchor just located an entry in it',
    );
    return bucket;
  }

  #requireAnchor(type: symbol, operation: string): AnchorLocation {
    for (const stage of STAGE_ORDER) {
      const bucket = this.#buckets.get(stage);
      if (bucket === undefined) continue;
      const index = bucket.findIndex(entry => entry.type === type);
      if (index !== -1) return {stage, index};
    }
    throw new AnchorNotFoundError(type, operation); // PIPE-21
  }

  #requireSameStage(anchorStage: Stage, incomingStage: Stage): void {
    if (anchorStage !== incomingStage)
      throw new CrossStageEditError(anchorStage, incomingStage); // PIPE-18/19
  }
}
