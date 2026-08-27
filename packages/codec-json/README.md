# @dexpace/codec-json

The reference JSON wire codec for the dexpace SDK — `JSON.parse`/`JSON.stringify` behind the `Serde`
seam, with PATCH tri-state semantics wired in by default. Zero dependencies beyond a `@dexpace/core`
peer.

```sh
bun add @dexpace/codec-json @dexpace/core
```

```typescript
import {decodeResponse, serdeBody, type Response} from '@dexpace/core';
import {jsonSerde} from '@dexpace/codec-json';
import {z} from 'zod'; // any schema library works — this package depends on none

const serde = jsonSerde();
const User = z.object({id: z.number(), name: z.string()});

// Content-Type defaults to the serde's own media type: application/json
export const body = serdeBody({name: 'ada'}, serde);

export async function readUser(response: Response) {
  return decodeResponse(response, serde.deserializer, {
    schema: User,
    typeName: 'User',
  });
}
```

The schema you pass is both the runtime witness and the source of the static type — there is no
separate type argument to keep in sync.

- **PATCH three-state fields** — `tristate()` and `tristateObject()`, documented on their own TSDoc in
  [`src/tristate-schema.ts`](./src/tristate-schema.ts). Absent omits the key, Null emits a wire
  `null`, Present emits the value; the wiring is on by default and `jsonSerde({tristate: false})` is
  the only way out.
- **Unknown wire fields** — your schema's decision, not this codec's. The rationale and the
  recommendation are on `jsonSerde`'s own TSDoc in [`src/json-serde.ts`](./src/json-serde.ts).
- **A top-level wire `null` never decodes**, and a top-level `undefined`, function, or symbol raises
  `SerializationError` rather than encoding as `null`. Both are on `jsonSerde`'s TSDoc too.
