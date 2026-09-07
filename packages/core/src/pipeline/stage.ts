// SPDX-License-Identifier: MIT
// packages/core/src/pipeline/stage.ts

/**
 * Fixed, totally-ordered pipeline stages (PIPE-1, PIPE-2). A string-literal union, not a TS `enum` --
 * `erasableSyntaxOnly` bars enums, and `Stage` has no behavior beyond ordering, which `STAGE_ORDER` alone
 * provides. `PRE_REDIRECT` is the outermost slot PIPE-2 mandates; `POST_REDIRECT`..`POST_SERDE` are PIPE-3's
 * SHOULD extension slots around every pillar. `SEND` is terminal and reserved -- PIPE-8, flattening skips it
 * and `PipelineBuilder` rejects any attempt to install a step there.
 *
 * @public
 */
export type Stage =
  | 'PRE_REDIRECT'
  | 'REDIRECT'
  | 'POST_REDIRECT'
  | 'PRE_RETRY'
  | 'RETRY'
  | 'POST_RETRY'
  | 'PRE_AUTH'
  | 'AUTH'
  | 'POST_AUTH'
  | 'PRE_LOGGING'
  | 'LOGGING'
  | 'POST_LOGGING'
  | 'PRE_SERDE'
  | 'SERDE'
  | 'POST_SERDE'
  | 'SEND';

/**
 * Declaration order (PIPE-1, PIPE-25): `PipelineBuilder.build()` flattens by walking this array. Inserting a
 * further stage later is one splice here -- no existing `Stage` value needs to change, so there is no
 * numeric-gap "renumbering" concern to design around.
 *
 * @public
 */
export const STAGE_ORDER: readonly Stage[] = [
  'PRE_REDIRECT',
  'REDIRECT',
  'POST_REDIRECT',
  'PRE_RETRY',
  'RETRY',
  'POST_RETRY',
  'PRE_AUTH',
  'AUTH',
  'POST_AUTH',
  'PRE_LOGGING',
  'LOGGING',
  'POST_LOGGING',
  'PRE_SERDE',
  'SERDE',
  'POST_SERDE',
  'SEND',
];

/** A pillar stage admits at most one step (PIPE-4). @public */
export const PILLAR_STAGES: ReadonlySet<Stage> = new Set([
  'REDIRECT',
  'RETRY',
  'AUTH',
  'LOGGING',
  'SERDE',
]);
