// SPDX-License-Identifier: MIT
// packages/core/src/observability/diagnostic-context.ts
// The one sanctioned node: import in this phase (see Global Constraints) -- AsyncLocalStorage has no
// cross-runtime equivalent, and this is the only mechanism Node offers for OBS-24's async-boundary bridge.
import {AsyncLocalStorage} from 'node:async_hooks';
import {invariant} from '../invariant.js';

type DiagnosticStore = ReadonlyMap<string, string>;

const storage = new AsyncLocalStorage<DiagnosticStore>();

/** OBS-24: an immutable, shareable snapshot of the diagnostic context at capture time. */
export interface DiagnosticSnapshot {
  readonly store: DiagnosticStore;
}

/**
 * OBS-24 (partial, by construction): AsyncLocalStorage already auto-propagates its store across `await`,
 * promise chains, and timers via async_hooks, covering most of the reference's manual thread-local-bridge
 * requirement for free. Pushes `fields` for the duration of `fn`, restoring the prior store afterward
 * (including on throw, via AsyncLocalStorage.run's own guarantee).
 */
export function withDiagnosticFields<T>(
  fields: Readonly<Record<string, string>>,
  fn: () => T,
): T {
  invariant(
    typeof fields === 'object' && (fields as unknown) !== null,
    'withDiagnosticFields: fields must be an object',
  );
  const current = storage.getStore() ?? new Map<string, string>();
  const next = new Map(current);
  for (const [key, value] of Object.entries(fields)) next.set(key, value);
  return storage.run(next, fn);
}

/** OBS-10: default allow-list is exactly {trace.id, span.id}; null allow-list folds every present key. */
export function getDiagnosticContext(
  allowList: readonly string[] | null,
): Readonly<Record<string, string>> {
  const store = storage.getStore();
  if (store === undefined) return {};
  const keys = allowList ?? [...store.keys()];
  const result: Record<string, string> = {};
  for (const key of keys) {
    const value = store.get(key);
    if (value !== undefined && (value as unknown) !== null) {
      // Use defineProperty to safely set keys (including __proto__) without mutating Object.prototype.
      Object.defineProperty(result, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  return result;
}

/**
 * OBS-24's explicit bridge, for the residual case AsyncLocalStorage's automatic propagation doesn't cover: a
 * callback invoked from outside the tracked continuation chain entirely (e.g. a raw event-emitter callback,
 * or `setImmediate`/a third-party callback API that isn't `await`ed from the capturing scope).
 */
export function captureDiagnosticSnapshot(): DiagnosticSnapshot {
  return {store: storage.getStore() ?? new Map()};
}

export function runWithSnapshot<T>(
  snapshot: DiagnosticSnapshot,
  fn: () => T,
): T {
  return storage.run(snapshot.store, fn);
}

/**
 * The scope-handle form of `withDiagnosticFields`, for callers that cannot express their scope as a single
 * callback -- OBS-23's span-correlation scope is one: a pipeline step pushes before `await next(...)` and
 * restores after, with the two halves in different statements. Returns the restore function.
 *
 * **The restore reaches only the continuation that called it.** `enterWith` installs the store on the
 * *current* async resource and every resource created from it; the returned function does the same with
 * the previous store. Call it after an `await` and it runs on a different resource, so the caller that
 * pushed keeps the pushed fields for the rest of its own continuation -- which is a leak when that caller
 * is a library entry point and the continuation is the application's. Use `withDiagnosticFields` whenever
 * the scope CAN be written as one callback; that form is `AsyncLocalStorage.run`, which restores on exit
 * by construction. `Runtime.send` used this handle until 2026-09-05 and leaked `trace.id`/`span.id` into
 * every subsequent application log (audit #67 / #80).
 */
export function pushDiagnosticFields(
  fields: Readonly<Record<string, string>>,
): () => void {
  invariant(
    typeof fields === 'object' && (fields as unknown) !== null,
    'pushDiagnosticFields: fields must be an object',
  );
  const previous = storage.getStore();
  const next = new Map(previous ?? []);
  for (const [key, value] of Object.entries(fields)) next.set(key, value);
  storage.enterWith(next);

  let restored = false;
  return (): void => {
    if (restored) return;
    restored = true;
    storage.enterWith(previous as unknown as DiagnosticStore);
  };
}

/**
 * `node:async_hooks` is confined to this file (see Global Constraints), so any other module needing
 * async-scoped storage — `tracing.ts`'s current-span slot is the only one this phase adds — takes it from
 * here rather than importing `AsyncLocalStorage` a second time.
 */
export interface AsyncScopedStore<T> {
  get(): T | undefined;
  /**
   * Installs `value` for the rest of this async context; the returned function restores the prior value.
   *
   * Carries `pushDiagnosticFields`' caveat verbatim: the restore is an `enterWith` of its own, so it takes
   * effect only on the async resource that runs it. A handle closed after an `await` leaves `value`
   * installed on the resource that entered it. Prefer {@link AsyncScopedStore.run} for any scope that can
   * be written as one callback.
   */
  enter(value: T): () => void;
  /**
   * Runs `fn` with `value` installed, restoring whatever was installed before when `fn` returns --
   * including on a throw, and including for anything `fn` itself entered with the handle form. This is
   * `AsyncLocalStorage.run`, so the restore is structural rather than a call a later continuation has to
   * remember to make, and it is what a library entry point must use if the caller's context is to survive
   * the call.
   *
   * `fn`'s return value is passed through untouched: an `async` callback hands back its promise, and the
   * store is restored when the callback's synchronous prefix returns, not when the promise settles. That
   * is the intended scoping -- everything the promise chain does inherits the store from the resource it
   * was created on.
   */
  run<R>(value: T, fn: () => R): R;
}

export function createAsyncScopedStore<T>(): AsyncScopedStore<T> {
  const scoped = new AsyncLocalStorage<T>();
  return {
    get: () => scoped.getStore(),
    run<R>(value: T, fn: () => R): R {
      return scoped.run(value, fn);
    },
    enter(value: T): () => void {
      const previous = scoped.getStore();
      scoped.enterWith(value);
      let restored = false;
      return (): void => {
        if (restored) return;
        restored = true;
        // `as`: enterWith's signature is `(store: T)`, but restoring "there was nothing here before" is
        // exactly `undefined`, and getStore() returning undefined afterwards is the correct observable state.
        scoped.enterWith(previous as T);
      };
    },
  };
}
