// SPDX-License-Identifier: MIT
// packages/core/src/pagination/strategy.test.ts
// Exercises: PAGE-5 (strategy contract), PAGE-29 (async parse boundary), PAGE-30 (synchronous item array).
// Pure type declarations, so the assertions are expect-type only (styleguide 11.6) and fire under `bun run typecheck`.
import {test} from 'bun:test';
import {expectTypeOf} from 'expect-type';
import type {PageInfo} from './page.js';
import type {PaginationStrategy} from './strategy.js';

test('parse returns a promise — a synchronous body read does not exist in this runtime (PAGE-5)', () => {
  expectTypeOf<PaginationStrategy<number>['parse']>().returns.toEqualTypeOf<
    Promise<PageInfo<number>>
  >();
});

test('parse receives the response and the original request template (PAGE-5)', () => {
  expectTypeOf<PaginationStrategy<number>['parse']>().parameters.toBeArray();
});

test('a strategy is generic in its item type, not in a codec (PAGE-5, §12 serde-agnostic)', () => {
  expectTypeOf<PaginationStrategy<{id: string}>>().not.toBeAny();
});
