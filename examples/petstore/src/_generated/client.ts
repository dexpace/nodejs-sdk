// SPDX-License-Identifier: MIT
// examples/petstore/src/_generated/client.ts
/**
 * The petstore facade — GENERATED; do not edit.
 *
 * Rendered from `examples/petstore/spec/petstore.openapi.json` by
 * `examples/petstore/generate.mjs`. Projection only: every method binds its arguments into an
 * `OperationInput` and delegates to the shared `ServiceCore`, and carries no logic of its own.
 *
 * ONE facade, not two — Node is async-only, so the sync/async split the Python witness renders (and
 * the AST-parity gate that keeps the two honest) has nothing to correspond to here.
 */

import type {Paginator} from '@dexpace/core';
import {PET_SCHEMA} from '../models.js';
import type {Pet, PetEvent, PetPatch} from '../models.js';
import {NO_INPUT} from '../operation.js';
import type {CallOptions, ServiceCore} from '../service-core.js';
import {
  PET_EVENT_MAPPER,
  PET_PAGE_STRATEGY,
  jsonBody,
  petPatchToWire,
} from '../support.js';
import * as operations from './operations.js';

/** The petstore client — a projection over `ServiceCore`. */
export class PetStoreClient {
  readonly #core: ServiceCore;

  constructor(core: ServiceCore) {
    this.#core = core;
  }

  /** `GET /pets/{pet_id}` — Fetch one pet by id. */
  getPet(petId: string, call: CallOptions = {}): Promise<Pet> {
    return this.#core.execute(
      operations.GET_PET,
      {pathParams: {pet_id: petId}},
      {...call, responseType: {schema: PET_SCHEMA, typeName: 'Pet'}},
    );
  }

  /** `GET /pets` — List pets, paginating by opaque cursor. */
  listPets(
    paging: CallOptions & {maxPages?: number | undefined} = {},
  ): Paginator<Pet> {
    return this.#core.paginate(operations.LIST_PETS, NO_INPUT, {
      ...paging,
      strategy: PET_PAGE_STRATEGY,
    });
  }

  /** `PATCH /pets/{pet_id}` — Apply a merge-patch update to a pet. */
  updatePet(
    petId: string,
    patch: PetPatch,
    call: CallOptions = {},
  ): Promise<Pet> {
    return this.#core.execute(
      operations.UPDATE_PET,
      {
        pathParams: {pet_id: petId},
        body: jsonBody(petPatchToWire(patch), 'application/merge-patch+json'),
      },
      {...call, responseType: {schema: PET_SCHEMA, typeName: 'Pet'}},
    );
  }

  /** `GET /pets/events` — Stream pet lifecycle events over Server-Sent Events. */
  watchPets(streaming: CallOptions = {}): AsyncIterable<PetEvent> {
    return this.#core.events(operations.WATCH_PETS, NO_INPUT, {
      ...streaming,
      mapper: PET_EVENT_MAPPER,
    });
  }

  /** Releases whatever the executor owns; a borrowed runtime is left alone. */
  close(): Promise<void> {
    return this.#core.close();
  }
}
