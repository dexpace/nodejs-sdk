// SPDX-License-Identifier: MIT
// examples/petstore/generate.mjs
/**
 * Deterministic generator for the petstore codegen canary.
 *
 * Reads the frozen OpenAPI document (`spec/petstore.openapi.json`) — byte-identical to the one the
 * Python witness uses — and renders the checked-in output under `src/_generated/`:
 *
 * - `operations.ts` — the operation table, pure `Operation` data;
 * - `client.ts` — the projection-only facade. ONE facade, not two: Node is async-only, so the
 *   sync/async mode switch the Python generator carries has nothing to switch on and the parity
 *   gate that compares the two has no twin here.
 *
 * The output is deterministic — operations sorted by id, a fixed import order, no timestamps — so
 * re-running reproduces the checked-in files byte for byte. `regen.test.ts` asserts exactly that.
 *
 *   node examples/petstore/generate.mjs
 *
 * `renderAll()` is the pure entry point (name -> content) the regen test compares against the tree
 * without touching the filesystem.
 *
 * **The rendered text is run through Prettier before it is returned.** Predicting Prettier's line
 * breaking by hand is a losing game, and `gts lint .` at the repository root DOES lint
 * `examples/` — formatting is an error there, not a warning. So the generator formats with the
 * exact options `eslint.config.js` feeds the `prettier/prettier` rule, resolved from the same
 * `gts/.prettierrc.json`. One consequence worth knowing: a Prettier upgrade can change the
 * checked-in bytes, and the regen test is what tells you to re-run this script.
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import process from 'node:process';
import {fileURLToPath, pathToFileURL} from 'node:url';

const require = createRequire(import.meta.url);

/** The same file `eslint.config.js` sources, resolved the same way. */
const PRETTIER_RC_PATH = require.resolve('gts/.prettierrc.json');
const PRETTIER_OPTIONS = require(PRETTIER_RC_PATH);

const HERE = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = join(HERE, 'spec', 'petstore.openapi.json');
const OUT_DIR = join(HERE, 'src', '_generated');

/** HTTP methods recognised in a path item, in OpenAPI order. */
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch'];

/** Matches a single `{name}` path placeholder. */
const PLACEHOLDER = /\{([^{}]+)\}/g;

/**
 * The document's scheme vocabulary, mapped onto `AuthScheme` — core's closed union.
 *
 * The frozen document says `bearer`; core says `OAUTH2`. A real generator needs this table (or a
 * `securitySchemes` walk that produces it), because `AuthScheme` is deliberately closed and an
 * unmapped name is a generation-time failure rather than a runtime one.
 */
const SCHEME_BY_SPEC_NAME = {
  apikey: 'API_KEY',
  basic: 'BASIC',
  bearer: 'OAUTH2',
  digest: 'DIGEST',
};

/** Line 1 is NFR-13's SPDX marker, line 2 the repository's file-path comment convention. */
function header(relativePath) {
  return `// SPDX-License-Identifier: MIT\n// ${relativePath}`;
}

/** Lazily-resolved Prettier, reached through gts so no root dependency is added. */
let prettierPromise;

function prettier() {
  prettierPromise ??= import(
    pathToFileURL(createRequire(PRETTIER_RC_PATH).resolve('prettier')).href
  ).then(module => module.default ?? module);
  return prettierPromise;
}

/** `get_pet` -> `getPet`. */
function camel(snake) {
  return snake.replace(/_([a-z0-9])/g, (_match, ch) => ch.toUpperCase());
}

/** `get_pet` -> `GET_PET`. */
function constantCase(snake) {
  return snake.toUpperCase();
}

/** `PetPatch` -> `PET_PATCH`. */
function constantCaseOfModel(pascal) {
  return pascal.replace(/(?<!^)([A-Z])/g, '_$1').toUpperCase();
}

/** `PetPatch` -> `petPatch`. */
function lowerCamelOfModel(pascal) {
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/** Read the frozen document. */
export function loadSpec(specPath = SPEC_PATH) {
  return JSON.parse(readFileSync(specPath, 'utf8'));
}

function optionalString(value) {
  return value === undefined || value === null ? undefined : String(value);
}

/** Normalise the `auth` extension into `{scheme, scopes}` records, schemes already mapped. */
function authOf(value) {
  if (!Array.isArray(value)) return [];
  return value.map(alternative => {
    const specName = String(alternative.scheme);
    const scheme = SCHEME_BY_SPEC_NAME[specName];
    if (scheme === undefined) {
      throw new Error(`unmapped auth scheme "${specName}" in the document`);
    }
    return {scheme, scopes: (alternative.scopes ?? []).map(String)};
  });
}

/** The single request-body media type, or undefined when the operation declares no body. */
function bodyMediaTypeOf(entry) {
  const content = entry.requestBody?.content;
  if (content === undefined) return undefined;
  const types = Object.keys(content).sort();
  if (types.length !== 1) {
    throw new Error(
      `expected exactly one request-body media type, got ${String(types.length)}`,
    );
  }
  return types[0];
}

/** Normalise one path-item operation into the record the renderers read. */
function opFromEntry(path, method, entry) {
  const ext = entry['x-dexpace'] ?? {};
  const body = ext.body ?? {};
  return {
    operationId: String(entry.operationId),
    summary: String(entry.summary ?? '')
      .replace(/\s+/g, ' ')
      .trim(),
    method: method.toUpperCase(),
    path,
    kind: String(ext.kind),
    pathParams: [...path.matchAll(PLACEHOLDER)].map(match => match[1]),
    returns: optionalString(ext.returns),
    bodyParam: optionalString(body.param),
    bodyModel: optionalString(body.model),
    bodyMediaType: bodyMediaTypeOf(entry),
    itemModel: optionalString(ext.item_model),
    strategy: optionalString(ext.strategy),
    eventModel: optionalString(ext.event_model),
    mapper: optionalString(ext.mapper),
    auth: authOf(ext.auth),
  };
}

/** Every operation in the document, sorted by id so rendering is stable. */
export function collectOperations(spec) {
  const ops = [];
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const entry = item[method];
      if (entry !== undefined) ops.push(opFromEntry(path, method, entry));
    }
  }
  return ops.sort((a, b) => (a.operationId < b.operationId ? -1 : 1));
}

const OPERATIONS_DOC = `/**
 * Operation table for the petstore canary — GENERATED; do not edit.
 *
 * Rendered from \`examples/petstore/spec/petstore.openapi.json\` by
 * \`examples/petstore/generate.mjs\`. Pure data: one frozen \`Operation\` per \`operationId\`, in
 * id-sorted order. Re-render with \`node examples/petstore/generate.mjs\`.
 */`;

function authConstName(op) {
  return `${constantCase(op.operationId)}_AUTH`;
}

function renderRequirement(requirement) {
  if (requirement.scopes.length === 0) {
    return `createAuthRequirement('${requirement.scheme}')`;
  }
  const scopes = requirement.scopes.map(scope => `'${scope}'`).join(', ');
  return `createAuthRequirement('${requirement.scheme}', [${scopes}])`;
}

/** Render the operation-table module. */
export function renderOperations(ops) {
  const withAuth = ops.filter(op => op.auth.length > 0);
  const lines = [
    header('examples/petstore/src/_generated/operations.ts'),
    OPERATIONS_DOC,
    '',
  ];
  if (withAuth.length > 0) {
    lines.push(
      "import {createAuthDescriptor, createAuthRequirement} from '@dexpace/core';",
    );
  }
  lines.push("import type {Operation} from '../operation.js';", '');
  for (const op of withAuth) {
    const requirements = op.auth.map(renderRequirement).join(', ');
    lines.push(
      `const ${authConstName(op)} = createAuthDescriptor([${requirements}]);`,
      '',
    );
  }
  for (const op of ops) {
    lines.push(`/** \`${op.method} ${op.path}\` — ${op.summary} */`);
    lines.push(
      `export const ${constantCase(op.operationId)}: Operation = Object.freeze<Operation>({`,
      `name: '${op.operationId}',`,
      `method: '${op.method}',`,
      `pathTemplate: '${op.path}',`,
    );
    if (op.auth.length > 0) lines.push(`auth: ${authConstName(op)},`);
    lines.push('});', '');
  }
  return lines.join('\n');
}

const CLIENT_DOC = `/**
 * The petstore facade — GENERATED; do not edit.
 *
 * Rendered from \`examples/petstore/spec/petstore.openapi.json\` by
 * \`examples/petstore/generate.mjs\`. Projection only: every method binds its arguments into an
 * \`OperationInput\` and delegates to the shared \`ServiceCore\`, and carries no logic of its own.
 *
 * ONE facade, not two — Node is async-only, so the sync/async split the Python witness renders (and
 * the AST-parity gate that keeps the two honest) has nothing to correspond to here.
 */`;

/** The runtime schema constant a model's decode witness is named by, in `models.ts`. */
function schemaConst(model) {
  return `${constantCaseOfModel(model)}_SCHEMA`;
}

/** The hand-written encoder a body model is projected through, in `support.ts`. */
function encoderName(model) {
  return `${lowerCamelOfModel(model)}ToWire`;
}

function sortedUnique(values) {
  return [...new Set(values.filter(value => value !== undefined))].sort();
}

/** Render the facade's import block. Order is fixed, so the output is stable. */
function renderClientImports(ops) {
  const lines = [];
  if (ops.some(op => op.kind === 'paginate')) {
    lines.push("import type {Paginator} from '@dexpace/core';");
  }
  const schemas = sortedUnique(ops.map(op => op.returns)).map(schemaConst);
  if (schemas.length > 0) {
    lines.push(`import {${schemas.join(', ')}} from '../models.js';`);
  }
  const models = sortedUnique([
    ...ops.map(op => op.returns),
    ...ops.map(op => op.bodyModel),
    ...ops.map(op => op.itemModel),
    ...ops.map(op => op.eventModel),
  ]);
  if (models.length > 0) {
    lines.push(`import type {${models.join(', ')}} from '../models.js';`);
  }
  if (
    ops.some(op => op.pathParams.length === 0 && op.bodyParam === undefined)
  ) {
    lines.push("import {NO_INPUT} from '../operation.js';");
  }
  lines.push(
    "import type {CallOptions, ServiceCore} from '../service-core.js';",
  );
  const support = sortedUnique([
    ...ops.map(op => (op.bodyParam === undefined ? undefined : 'jsonBody')),
    ...ops.map(op =>
      op.bodyModel === undefined ? undefined : encoderName(op.bodyModel),
    ),
    ...ops.map(op => op.strategy),
    ...ops.map(op => op.mapper),
  ]);
  if (support.length > 0) {
    lines.push(`import {${support.join(', ')}} from '../support.js';`);
  }
  lines.push("import * as operations from './operations.js';");
  return lines;
}

/** The `OperationInput` literal for one operation, or `NO_INPUT` when it has nothing to bind. */
function renderInput(op) {
  const parts = [];
  if (op.pathParams.length > 0) {
    const pairs = op.pathParams
      .map(name => `${name}: ${camel(name)}`)
      .join(', ');
    parts.push(`pathParams: {${pairs}}`);
  }
  if (op.bodyParam !== undefined && op.bodyModel !== undefined) {
    parts.push(
      `body: jsonBody(${encoderName(op.bodyModel)}(${camel(op.bodyParam)}), '${op.bodyMediaType}')`,
    );
  }
  return parts.length === 0 ? 'NO_INPUT' : `{${parts.join(', ')}}`;
}

/** The declared parameters of a facade method, path params first, then any body, then the bag. */
function renderParams(op, bagName, bagType) {
  const params = op.pathParams.map(name => `${camel(name)}: string`);
  if (op.bodyParam !== undefined && op.bodyModel !== undefined) {
    params.push(`${camel(op.bodyParam)}: ${op.bodyModel}`);
  }
  params.push(`${bagName}: ${bagType} = {}`);
  return params.join(', ');
}

function renderUnaryMethod(op) {
  const target = `{schema: ${schemaConst(op.returns)}, typeName: '${op.returns}'}`;
  return [
    `/** \`${op.method} ${op.path}\` — ${op.summary} */`,
    `${camel(op.operationId)}(${renderParams(op, 'call', 'CallOptions')}): Promise<${op.returns}> {`,
    `return this.#core.execute(operations.${constantCase(op.operationId)}, ${renderInput(op)}, {...call, responseType: ${target}});`,
    '}',
  ].join('\n');
}

function renderPaginateMethod(op) {
  const bagType = 'CallOptions & {maxPages?: number | undefined}';
  return [
    `/** \`${op.method} ${op.path}\` — ${op.summary} */`,
    `${camel(op.operationId)}(${renderParams(op, 'paging', bagType)}): Paginator<${op.itemModel}> {`,
    `return this.#core.paginate(operations.${constantCase(op.operationId)}, ${renderInput(op)}, {...paging, strategy: ${op.strategy}});`,
    '}',
  ].join('\n');
}

function renderEventsMethod(op) {
  return [
    `/** \`${op.method} ${op.path}\` — ${op.summary} */`,
    `${camel(op.operationId)}(${renderParams(op, 'streaming', 'CallOptions')}): AsyncIterable<${op.eventModel}> {`,
    `return this.#core.events(operations.${constantCase(op.operationId)}, ${renderInput(op)}, {...streaming, mapper: ${op.mapper}});`,
    '}',
  ].join('\n');
}

function renderMethod(op) {
  if (op.kind === 'paginate') return renderPaginateMethod(op);
  if (op.kind === 'events') return renderEventsMethod(op);
  return renderUnaryMethod(op);
}

/** Render the facade module. */
export function renderClient(ops, className) {
  const blocks = [
    [
      '/** The petstore client — a projection over `ServiceCore`. */',
      `export class ${className} {`,
      'readonly #core: ServiceCore;',
      '',
      'constructor(core: ServiceCore) {',
      'this.#core = core;',
      '}',
    ].join('\n'),
    ...ops.map(renderMethod),
    [
      '/** Releases whatever the executor owns; a borrowed runtime is left alone. */',
      'close(): Promise<void> {',
      'return this.#core.close();',
      '}',
    ].join('\n'),
  ];
  return [
    header('examples/petstore/src/_generated/client.ts'),
    CLIENT_DOC,
    '',
    ...renderClientImports(ops),
    '',
    blocks.join('\n\n'),
    '}',
    '',
  ].join('\n');
}

/**
 * Render every generated file as `name -> content`, Prettier-formatted.
 *
 * Pure beyond reading the frozen document: it writes nothing.
 */
export async function renderAll(specPath = SPEC_PATH) {
  const spec = loadSpec(specPath);
  const ops = collectOperations(spec);
  const className = String(
    spec['x-dexpace-codegen']?.client_class ?? 'ApiClient',
  );
  const raw = {
    'operations.ts': renderOperations(ops),
    'client.ts': renderClient(ops, className),
  };
  const {format} = await prettier();
  const rendered = new Map();
  for (const [name, content] of Object.entries(raw)) {
    rendered.set(
      name,
      await format(content, {...PRETTIER_OPTIONS, parser: 'typescript'}),
    );
  }
  return rendered;
}

/** Render and write every generated file into `outDir`. */
export async function writeAll(specPath = SPEC_PATH, outDir = OUT_DIR) {
  const rendered = await renderAll(specPath);
  for (const [name, content] of rendered) {
    writeFileSync(join(outDir, name), content, 'utf8');
  }
  return rendered.size;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const count = await writeAll();
  process.stdout.write(`generated ${String(count)} files into ${OUT_DIR}\n`);
}
