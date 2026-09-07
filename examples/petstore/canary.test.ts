// SPDX-License-Identifier: MIT
// examples/petstore/canary.test.ts
// End-to-end canary for the generated petstore SDK against the head core, over an in-memory
// transport. Each scenario proves one certified capability reaches a caller THROUGH the generated
// facade rather than through a hand-written call:
//
//   PAGE-1/PAGE-10/PAGE-16  listPets walks two cursor pages, splices `?cursor=`, honours maxPages
//   SSE-33/SSE-34           watchPets maps frames and stops on the `[DONE]` sentinel
//   BODY-30/HTTP-52         a 404 and a 500 arrive as the status map's typed errors
//   AUTH-4/AUTH-5/AUTH-6    the operation tier beats the client default, falls back when absent,
//                           and fails loudly — with no request sent — when present-but-unsatisfiable
//   SERDE-15/SERDE-19       a merge-patch body carries Absent / Null / Present intact
//   SEAM-14/PIPE-27         an owned transport is closed; a borrowed runtime is not
//
// Run with `bun test ./examples/petstore` after `bun run build`. NOT part of `bun run test`.
import {expect, test} from 'bun:test';
import {
  ApiKeyCredential,
  AuthResolutionError,
  createAuthDescriptor,
  createAuthRequirement,
  createBearerToken,
  isAbsent,
  isNull,
  isPresent,
  nullValue,
  present,
  standardResilience,
  type ApiKeyCredentialConfig,
  type AuthStepSettings,
  type BearerCredential,
} from '@dexpace/core';
import {jsonSerde} from '@dexpace/codec-json';
import {PetStoreClient} from './src/_generated/client.js';
import {
  PETSTORE_ERRORS,
  PetNotFoundError,
  PetStoreError,
  type StatusErrorMap,
} from './src/errors.js';
import {
  LocalFakeTransport,
  readBodyBytes,
  type ScriptedReply,
} from './src/fake-transport.js';
import {
  PET_PATCH_SCHEMA,
  emptyPetPatch,
  type Pet,
  type PetEvent,
  type PetPatch,
} from './src/models.js';
import {ServiceCore} from './src/service-core.js';

const BASE = 'https://api.example.com';
const SERDE = jsonSerde();
const DECODER = new TextDecoder();

const API_KEY: ApiKeyCredentialConfig = {
  credential: new ApiKeyCredential('k-123'),
  headerName: 'X-Api-Key',
};

const BEARER: BearerCredential = {
  provider: () => Promise.resolve(createBearerToken('t-abc')),
};

/**
 * A client-tier default of `API_KEY`, with the bearer credential present or absent.
 *
 * Absent is the unsatisfiable case: `getPet` declares an `OAUTH2` requirement, AUTH-4 selects the
 * tier by PRESENCE, and AUTH-5 judges satisfiability on configured credentials — so the call must
 * fail rather than quietly fall through to the satisfiable `API_KEY` default below it.
 */
function authSettings(withBearer: boolean): AuthStepSettings {
  return {
    credentials: withBearer
      ? {apiKey: API_KEY, bearer: BEARER}
      : {apiKey: API_KEY},
    tiers: {client: createAuthDescriptor([createAuthRequirement('API_KEY')])},
  };
}

interface Harness {
  readonly client: PetStoreClient;
  readonly transport: LocalFakeTransport;
}

function harness(
  script: readonly ScriptedReply[],
  options: {
    readonly auth?: AuthStepSettings | undefined;
    readonly errors?: StatusErrorMap | undefined;
  } = {},
): Harness {
  const transport = new LocalFakeTransport(script);
  const core = new ServiceCore({
    baseUrl: BASE,
    transport,
    serde: SERDE,
    resilience: options.auth === undefined ? undefined : {auth: options.auth},
    errors: options.errors,
  });
  return {client: new PetStoreClient(core), transport};
}

function petJson(id: string, name: string): string {
  return JSON.stringify({id, name, tag: null});
}

const PAGE_ONE = JSON.stringify({
  data: [
    {id: '1', name: 'a', tag: null},
    {id: '2', name: 'b', tag: null},
  ],
  next_cursor: 'c2',
});

const PAGE_TWO = JSON.stringify({
  data: [{id: '3', name: 'c', tag: null}],
  next_cursor: null,
});

function sseBody(): string {
  const frames = [
    JSON.stringify({kind: 'created', pet_id: '1'}),
    JSON.stringify({kind: 'updated', pet_id: '1'}),
    '[DONE]',
  ];
  return frames.map(frame => `data: ${frame}\n\n`).join('');
}

function namedPatch(): PetPatch {
  return {...emptyPetPatch(), name: present('Rex')};
}

// --------------------------------------------------------------------------------------------
// paginate
// --------------------------------------------------------------------------------------------

test('listPets walks two cursor pages and yields typed pets', async () => {
  const {client, transport} = harness([
    {status: 200, body: PAGE_ONE},
    {status: 200, body: PAGE_TWO},
  ]);
  const pets: Pet[] = [];
  for await (const pet of client.listPets().items()) pets.push(pet);

  expect(pets.map(pet => pet.name)).toEqual(['a', 'b', 'c']);
  expect(transport.calls).toHaveLength(2);
  // PAGE-16: the cursor is spliced onto the request that produced the page, not re-derived.
  expect(transport.calls[1]?.request.url.search).toBe('?cursor=c2');
  await client.close();
});

test('maxPages caps the walk at one exchange', async () => {
  const {client, transport} = harness([
    {status: 200, body: PAGE_ONE},
    {status: 200, body: PAGE_TWO},
  ]);
  const pets: Pet[] = [];
  for await (const pet of client.listPets({maxPages: 1}).items())
    pets.push(pet);

  expect(pets.map(pet => pet.name)).toEqual(['a', 'b']);
  expect(transport.calls).toHaveLength(1);
  await client.close();
});

// --------------------------------------------------------------------------------------------
// events
// --------------------------------------------------------------------------------------------

test('watchPets yields mapped events and stops on the [DONE] sentinel', async () => {
  const {client, transport} = harness([
    {
      status: 200,
      body: sseBody(),
      headers: {'content-type': 'text/event-stream'},
    },
  ]);
  const events: PetEvent[] = [];
  for await (const event of client.watchPets()) events.push(event);

  expect(events).toEqual([
    {kind: 'created', petId: '1'},
    {kind: 'updated', petId: '1'},
  ]);
  expect(transport.calls).toHaveLength(1);
  await client.close();
});

test('a failure status never reaches the SSE parser', async () => {
  const {client} = harness([{status: 404, body: '{"message":"nope"}'}], {
    errors: PETSTORE_ERRORS,
  });
  const iterate = async (): Promise<void> => {
    for await (const event of client.watchPets()) {
      throw new Error(`expected no event, got ${event.kind}`);
    }
  };

  const error = await iterate().catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(PetNotFoundError);
  await client.close();
});

// --------------------------------------------------------------------------------------------
// typed errors through the status map
// --------------------------------------------------------------------------------------------

test('a 404 arrives as the mapped PetNotFoundError', async () => {
  const {client} = harness([{status: 404, body: '{"message":"nope"}'}], {
    errors: PETSTORE_ERRORS,
  });

  const error = await client
    .updatePet('7', namedPatch())
    .catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(PetNotFoundError);
  expect((error as PetNotFoundError).status).toBe(404);
  expect((error as PetNotFoundError).preview).toBe('{"message":"nope"}');
  await client.close();
});

test('an unmapped error status falls back to the table default', async () => {
  const {client} = harness([{status: 500, body: 'boom'}], {
    errors: PETSTORE_ERRORS,
  });

  // `maxRetries: 0` because a 500 is retryable (RETRY-1/CFG-35) and this test is about the
  // mapping, not the budget — without it the walk burns the default attempts and their backoff.
  const error = await client
    .updatePet('7', namedPatch(), {maxRetries: 0})
    .catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(PetStoreError);
  expect(error).not.toBeInstanceOf(PetNotFoundError);
  await client.close();
});

// --------------------------------------------------------------------------------------------
// tiered auth
// --------------------------------------------------------------------------------------------

test('the operation tier wins over the client default', async () => {
  const {client, transport} = harness(
    [{status: 200, body: petJson('7', 'Rex')}],
    {auth: authSettings(true)},
  );

  // getPet declares OAUTH2 in the frozen document; the client default is API_KEY.
  await client.getPet('7');

  const headers = transport.calls[0]?.request.headers;
  expect(headers?.get('Authorization')).toBe('Bearer t-abc');
  expect(headers?.get('X-Api-Key')).toBeUndefined();
  await client.close();
});

test('an operation with no declared auth falls back to the client default', async () => {
  const {client, transport} = harness(
    [{status: 200, body: petJson('7', 'Rex')}],
    {auth: authSettings(true)},
  );

  await client.updatePet('7', namedPatch());

  const headers = transport.calls[0]?.request.headers;
  expect(headers?.get('X-Api-Key')).toBe('k-123');
  expect(headers?.get('Authorization')).toBeUndefined();
  await client.close();
});

test('a present but unsatisfiable tier fails loudly, with no request sent', async () => {
  const {client, transport} = harness(
    [{status: 200, body: petJson('7', 'Rex')}],
    {auth: authSettings(false)},
  );

  const error = await client.getPet('7').catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(AuthResolutionError);
  expect(transport.calls).toHaveLength(0);
  await client.close();
});

// --------------------------------------------------------------------------------------------
// merge-patch three-state round trip
// --------------------------------------------------------------------------------------------

test('a merge-patch body carries Absent, Null and Present intact', async () => {
  const {client, transport} = harness([
    {status: 200, body: petJson('7', 'Rex')},
  ]);

  // name -> Present, tag -> explicit Null, weightKg -> left Absent.
  await client.updatePet('7', {
    ...emptyPetPatch(),
    name: present('Rex'),
    tag: nullValue(),
  });

  const sent = transport.calls[0]?.request.body;
  if (sent === undefined) throw new Error('expected the facade to send a body');
  expect(sent.mediaType).toBe('application/merge-patch+json');

  const document: unknown = JSON.parse(
    DECODER.decode(await readBodyBytes(sent)),
  );
  // The Absent key is gone; the Null one survives as a wire null (SERDE-15).
  expect(document).toEqual({name: 'Rex', tag: null});

  const decoded = PET_PATCH_SCHEMA.parse(document);
  expect(isPresent(decoded.name) && decoded.name.value).toBe('Rex');
  expect(isNull(decoded.tag)).toBe(true);
  expect(isAbsent(decoded.weightKg)).toBe(true);
  await client.close();
});

// --------------------------------------------------------------------------------------------
// lifecycle
// --------------------------------------------------------------------------------------------

test('closing a core that owns its transport closes it exactly once', async () => {
  const transport = new LocalFakeTransport([{status: 200, body: '{}'}]);
  const client = new PetStoreClient(
    new ServiceCore({baseUrl: BASE, transport, serde: SERDE}),
  );

  await client.close();

  expect(transport.closeCount).toBe(1);
});

test('closing a core that borrows a runtime leaves the transport alone', async () => {
  const transport = new LocalFakeTransport([{status: 200, body: '{}'}]);
  const runtime = standardResilience(transport);
  const client = new PetStoreClient(
    new ServiceCore({baseUrl: BASE, runtime, serde: SERDE}),
  );

  await client.close();

  expect(transport.closeCount).toBe(0);
});

test('a core needs exactly one of transport or runtime', () => {
  const transport = new LocalFakeTransport([{status: 200}]);

  expect(() => new ServiceCore({baseUrl: BASE, serde: SERDE})).toThrow(
    TypeError,
  );
  expect(
    () =>
      new ServiceCore({
        baseUrl: BASE,
        serde: SERDE,
        transport,
        runtime: standardResilience(transport),
      }),
  ).toThrow(TypeError);
});
