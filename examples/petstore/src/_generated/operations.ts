// SPDX-License-Identifier: MIT
// examples/petstore/src/_generated/operations.ts
/**
 * Operation table for the petstore canary — GENERATED; do not edit.
 *
 * Rendered from `examples/petstore/spec/petstore.openapi.json` by
 * `examples/petstore/generate.mjs`. Pure data: one frozen `Operation` per `operationId`, in
 * id-sorted order. Re-render with `node examples/petstore/generate.mjs`.
 */

import {createAuthDescriptor, createAuthRequirement} from '@dexpace/core';
import type {Operation} from '../operation.js';

const GET_PET_AUTH = createAuthDescriptor([
  createAuthRequirement('OAUTH2', ['pets:read']),
]);

/** `GET /pets/{pet_id}` — Fetch one pet by id. */
export const GET_PET: Operation = Object.freeze<Operation>({
  name: 'get_pet',
  method: 'GET',
  pathTemplate: '/pets/{pet_id}',
  auth: GET_PET_AUTH,
});

/** `GET /pets` — List pets, paginating by opaque cursor. */
export const LIST_PETS: Operation = Object.freeze<Operation>({
  name: 'list_pets',
  method: 'GET',
  pathTemplate: '/pets',
});

/** `PATCH /pets/{pet_id}` — Apply a merge-patch update to a pet. */
export const UPDATE_PET: Operation = Object.freeze<Operation>({
  name: 'update_pet',
  method: 'PATCH',
  pathTemplate: '/pets/{pet_id}',
});

/** `GET /pets/events` — Stream pet lifecycle events over Server-Sent Events. */
export const WATCH_PETS: Operation = Object.freeze<Operation>({
  name: 'watch_pets',
  method: 'GET',
  pathTemplate: '/pets/events',
});
