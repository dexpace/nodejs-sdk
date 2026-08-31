// SPDX-License-Identifier: MIT
// packages/core/src/context/store.ts
import {invariant} from '../invariant.js';
import type {ExecutionContext} from './context.js';
import {DuplicateContextKeyError} from './errors.js';

// Backstop cap (CTX-11, XCUT-14); a leaked context pins its whole request/response graph, including a
// possibly unread body holding a connection.
const DEFAULT_MAX_ENTRIES = 10_000;

/**
 * A bounded, keyed store of in-flight execution contexts (CTX-7..13, CTX-18, CTX-19). Also the textbook
 * subject of `XCUT-14`, which names "context registries" first among the caller-keyed process-lived maps
 * that MUST carry a hard cap and drain back under it in a loop after each insert — an unbounded one is a
 * memory-exhaustion vector, not merely a leak. Thread-safety is
 * satisfied by construction: Node's single-threaded event loop means no two synchronous Map mutations
 * ever interleave, collapsing the reference's concurrent-map requirement into a plain Map. The Map holds
 * strong references — never WeakRef/WeakMap — so a registered context keeps its whole Request+Response
 * graph reachable and the cap, not the collector, is the leak backstop (CTX-19).
 *
 * @internal
 */
export class ContextStore {
  readonly #entries = new Map<symbol, ExecutionContext>();
  readonly #maxEntries: number;

  /**
   * @throws InvariantViolation when `maxEntries` is not a positive integer — a violated precondition,
   *   never an operational failure a caller recovers from.
   */
  constructor(maxEntries: number = DEFAULT_MAX_ENTRIES) {
    // A bad cap is a violated precondition — a programmer error — so it crashes at the fault via the
    // project's one assertion primitive rather than an ad-hoc `if (!x) throw`
    // (docs/knowledge/harvested/assertions.md:4, docs/knowledge/harvested/error-handling.md:36).
    invariant(
      Number.isInteger(maxEntries) && maxEntries >= 1,
      `maxEntries must be a positive integer, got ${String(maxEntries)}`,
    );
    this.#maxEntries = maxEntries;
  }

  /**
   * Install-or-replace; never throws (CTX-8). Nothing in 4a calls this — the promotion functions are
   * pure and never touch a store (CTX-17's negative half); 4c's pipeline is the first caller.
   */
  install(context: ExecutionContext): void {
    this.#entries.set(context.key, context);
    this.#drain();
    invariant(
      this.#entries.size <= this.#maxEntries,
      'context store above its cap after a drain',
    );
  }

  /**
   * Install only if absent; every other concurrent caller fails (CTX-8).
   *
   * @throws DuplicateContextKeyError when the key is already occupied. The error carries the offending
   *   `key` as a field — the symbol itself, not just its rendering in the message.
   */
  installIfAbsent(context: ExecutionContext): void {
    if (this.#entries.has(context.key)) {
      throw new DuplicateContextKeyError(context.key);
    }
    this.#entries.set(context.key, context);
    this.#drain();
    invariant(
      this.#entries.size <= this.#maxEntries,
      'context store above its cap after a drain',
    );
  }

  /** Absent key returns undefined, never throws (CTX-18). */
  get(key: symbol): ExecutionContext | undefined {
    return this.#entries.get(key);
  }

  /**
   * Evicts the slot only when the current occupant IS `context` (reference identity, CTX-9). Closing an
   * intermediate link already superseded by a later promotion, or an unknown/already-removed key, is a
   * well-defined no-op (CTX-10, CTX-18).
   */
  close(context: ExecutionContext): void {
    if (this.#entries.get(context.key) === context) {
      this.#entries.delete(context.key);
    }
  }

  /**
   * Drops every entry. Not part of `§7`'s contract — it exists so a test that must observe the shared
   * singleton (4c's runtime tests) can reset it. Prefer constructing an isolated `ContextStore`.
   */
  clear(): void {
    this.#entries.clear();
  }

  /** Entries currently tracked; at or below the cap once inserts quiesce (CTX-11, CTX-13). */
  get size(): number {
    return this.#entries.size;
  }

  #drain(): void {
    // CTX-12 / XCUT-14: a loop, not a single check-then-evict, so an insert burst converges to the cap.
    //
    // DO NOT "simplify" this loop into an `if`. On this runtime the two are behaviorally identical and
    // no test can tell them apart: both callers set exactly one key before draining, so the map is never
    // more than one over the cap at entry and the loop never needs a second pass. The loop survives
    // because CTX-12 and XCUT-14 mandate the shape for runtimes where concurrent inserts can stack
    // several overshoots before any drain runs — the burst test below pins the bound, not the shape.
    //
    // CTX-13: victim selection is arbitrary — oldest-inserted (Map iteration order) is the cheapest
    // choice, not a retention promise; callers must not rely on any particular entry surviving.
    //
    // No undefined-guard inside the loop: the constructor rejects maxEntries < 1, so `size > maxEntries`
    // proves size >= 2 and the iterator always yields. A guard here would be unreachable code the
    // coverage gate could never exercise.
    for (const oldestKey of this.#entries.keys()) {
      if (this.#entries.size <= this.#maxEntries) return;
      this.#entries.delete(oldestKey);
    }
  }
}

/**
 * The one registry 4c's `Runtime.send()` installs into. Module-level mutable state, which
 * `docs/knowledge/harvested/variables-and-declarations.md:22` bans — accepted here because threading a store handle
 * through builder → runtime → every step would be a wide API change for no observable gain, and logged in
 * the design's Deviation Ledger for Phase 10. Tests must build their own `new ContextStore()` rather than
 * asserting through this one: it is shared by every test file in a `bun test` run.
 *
 * @internal
 */
export const contextStore = new ContextStore();
