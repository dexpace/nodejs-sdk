// SPDX-License-Identifier: MIT
// scripts/verify-import-cycles.test.mjs
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {findCycle} from './verify-import-cycles.mjs';

/** Drives the search over a literal adjacency map, so no file is written. */
function edgesOf(graph) {
  return file => graph[file] ?? [];
}

test('an acyclic graph reports no cycle', () => {
  const graph = {a: ['b', 'c'], b: ['c'], c: []};
  assert.equal(findCycle(Object.keys(graph), edgesOf(graph)), null);
});

test('a two-node cycle is caught', () => {
  const graph = {a: ['b'], b: ['a']};
  assert.deepEqual(findCycle(Object.keys(graph), edgesOf(graph)), [
    'a',
    'b',
    'a',
  ]);
});

test('a self-import is caught', () => {
  const graph = {a: ['a']};
  assert.deepEqual(findCycle(Object.keys(graph), edgesOf(graph)), ['a', 'a']);
});

test('a longer cycle is reported with every file on it', () => {
  const graph = {a: ['b'], b: ['c'], c: ['a']};
  assert.deepEqual(findCycle(Object.keys(graph), edgesOf(graph)), [
    'a',
    'b',
    'c',
    'a',
  ]);
});

test('a cycle reachable only from an unrelated entry point is still caught', () => {
  // `entry` is acyclic itself; the cycle sits two hops in. A search that stopped at the first
  // finished component would miss it.
  const graph = {entry: ['a'], a: ['b'], b: ['c'], c: ['b']};
  assert.deepEqual(findCycle(Object.keys(graph), edgesOf(graph)), [
    'b',
    'c',
    'b',
  ]);
});

test('a diamond is not a cycle', () => {
  // Two paths reaching the same node is re-convergence, not recursion. A search that marked a node
  // "seen" without distinguishing "on the current path" from "finished" would report this.
  const graph = {a: ['b', 'c'], b: ['d'], c: ['d'], d: []};
  assert.equal(findCycle(Object.keys(graph), edgesOf(graph)), null);
});

test('an edge to a file outside the scanned set is ignored', () => {
  const graph = {a: ['outside']};
  assert.equal(findCycle(['a'], edgesOf(graph)), null);
});
