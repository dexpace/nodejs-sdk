// SPDX-License-Identifier: MIT
// packages/core/src/pipeline/stage.test.ts
// Exercises: PIPE-2 (the mandatory chain, outermost pre-redirect slot through terminal SEND), PIPE-3
// (pre/post extension slots around every pillar), PIPE-4 (exactly the 5 configurable pillars), PIPE-8 (SEND
// is the final, terminal stage)
import {describe, expect, test} from 'bun:test';
import {PILLAR_STAGES, STAGE_ORDER} from './stage.js';

describe('STAGE_ORDER (PIPE-2, PIPE-3)', () => {
  test('lists every stage exactly once, in declaration order', () => {
    expect(STAGE_ORDER).toEqual([
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
    ]);
    expect(new Set(STAGE_ORDER).size).toBe(STAGE_ORDER.length);
  });

  test('PRE_REDIRECT is the outermost slot (PIPE-2)', () => {
    expect(STAGE_ORDER.at(0)).toBe('PRE_REDIRECT');
  });

  test('SEND is the terminal, final stage (PIPE-8)', () => {
    expect(STAGE_ORDER.at(-1)).toBe('SEND');
  });
});

describe('PILLAR_STAGES (PIPE-4)', () => {
  test('is exactly REDIRECT, RETRY, AUTH, LOGGING, SERDE', () => {
    expect([...PILLAR_STAGES].sort()).toEqual([
      'AUTH',
      'LOGGING',
      'REDIRECT',
      'RETRY',
      'SERDE',
    ]);
  });

  test('does not include SEND or any extension slot', () => {
    expect(PILLAR_STAGES.has('SEND')).toBe(false);
    expect(PILLAR_STAGES.has('PRE_REDIRECT')).toBe(false);
    expect(PILLAR_STAGES.has('POST_LOGGING')).toBe(false);
  });
});
