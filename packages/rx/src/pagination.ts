// SPDX-License-Identifier: MIT
// packages/rx/src/pagination.ts
import type {Observable} from 'rxjs';
import type {Page, Paginator} from '@dexpace/core';
import {fromAsyncIterable} from './from-async-iterable.js';

/**
 * Bridges a {@link @dexpace/core#Paginator}'s item stream to a cold, repeatable RxJS `Observable` (PAGE-8).
 *
 * Each subscription obtains a fresh iterator from `Paginator.items()`, driving an independent pagination sequence
 * across all pages.
 *
 * @param paginator - The `Paginator` instance whose items to observe.
 * @returns An `Observable` emitting items of type `T` in server order.
 *
 * @public
 */
export function pageItems$<T>(paginator: Paginator<T>): Observable<T> {
  return fromAsyncIterable({
    [Symbol.asyncIterator]: () => paginator.items()[Symbol.asyncIterator](),
  });
}

/**
 * Bridges a {@link @dexpace/core#Paginator}'s page stream to a cold, repeatable RxJS `Observable` (PAGE-8).
 *
 * Each subscription obtains a fresh iterator from `Paginator.pages()`, driving an independent pagination sequence
 * yielding whole {@link @dexpace/core#Page} objects.
 *
 * @param paginator - The `Paginator` instance whose pages to observe.
 * @returns An `Observable` emitting {@link @dexpace/core#Page} objects.
 *
 * @public
 */
export function pages$<T>(paginator: Paginator<T>): Observable<Page<T>> {
  return fromAsyncIterable({
    [Symbol.asyncIterator]: () => paginator.pages()[Symbol.asyncIterator](),
  });
}
