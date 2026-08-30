# module-organization

## Rules
- Ship ESM as the module system, declaring `"type": "module"` in `package.json` so every `.ts`/`.js` is an ES module.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/12-module-organization.md:48-52` · high · sha:1b4c9a185aa5</sub>
- Confine any required CJS interop to a single declared bridge module (e.g., `vendor-bridge.ts`) that performs the `createRequire` or dynamic `import()` dance, documents why, and re-exports a clean ESM surface.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/12-module-organization.md:53-54` · high · sha:1b4c9a185aa5</sub>
- Write `import type` for every type-only import.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/12-module-organization.md:58-61` · high · sha:1b4c9a185aa5</sub>
- Prefer the top-level `import type { Foo }` form over inline `import { type Foo }` when every name in the statement is a type.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/12-module-organization.md:64-64` · high · sha:1b4c9a185aa5</sub>
- Group files by feature (e.g., `features/booking/`) rather than by technical kind (e.g., `services/`, `models/`, `components/`).
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/12-module-organization.md:68-73` · high · sha:1b4c9a185aa5</sub>
- Keep cross-feature primitives that have no feature home in a thin sibling `shared/` directory, since a fat `shared/` is just kind-folders wearing a different name.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/12-module-organization.md:74-74` · high · sha:1b4c9a185aa5</sub>
- Put barrel files (an `index.ts` that re-exports its neighbours) only at the package root, as the single curated public surface a consumer imports from.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/12-module-organization.md:78-81` · high · sha:1b4c9a185aa5</sub>
- Never create internal barrels (an `index.ts` in every folder); import the specific file directly instead, e.g. `import { reserve } from './seat-map.js'`.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/12-module-organization.md:82-84` · high · sha:1b4c9a185aa5</sub>
- Treat any import cycle (module A imports B, B imports A, directly or through a chain) as a bug, not a style nit.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/12-module-organization.md:88-93` · high · sha:1b4c9a185aa5</sub>
- Gate import cycles in CI with `madge --circular src` (or `eslint-plugin-import/no-cycle`) as a required check.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/12-module-organization.md:94-96` · high · sha:1b4c9a185aa5</sub>
- Forbid import-time side effects; importing a module may only define functions, classes, and constants — no network call, registry mutation, console write, or clock read at the top level.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/12-module-organization.md:98-101` · high · sha:1b4c9a185aa5</sub>
- Declare `"sideEffects": false` in `package.json` as the explicit promise that a package has no import-time side effects, letting the bundler drop unused modules.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/12-module-organization.md:104-104` · high · sha:1b4c9a185aa5</sub>
- Code that genuinely needs an import-time effect (registering a global, a polyfill bridge) must expose an explicit `init()` function the caller invokes, and list that single file in the `sideEffects` array.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/12-module-organization.md:104-104` · high · sha:1b4c9a185aa5</sub>
- Order imports into three blank-line-separated groups: `node:` built-ins first, then third-party packages, then the project's own modules.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/12-module-organization.md:108-114` · high · sha:1b4c9a185aa5</sub>
- Alphabetize imports within each import group.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/12-module-organization.md:113-113` · high · sha:1b4c9a185aa5</sub>
- Always use the `node:` protocol prefix on Node.js built-in imports (e.g., `node:crypto`, `node:fs`).
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/12-module-organization.md:114-114` · high · sha:1b4c9a185aa5</sub>
- Keep relative imports shallow, at most two levels up; `../../foo.js` is the edge and `../../../foo.js` signals the importer and imported file are structurally too far apart.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/12-module-organization.md:118-121` · high · sha:1b4c9a185aa5</sub>
- Fix a deep relative-import chain structurally — move the files into the same feature folder or promote the shared thing into `shared/` — rather than papering over the depth with a path alias.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/12-module-organization.md:123-124` · high · sha:1b4c9a185aa5</sub>
- Write each module to read top-down like a story: the public, most abstract entry point first, then the helpers it leans on in decreasing order of abstraction.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/12-module-organization.md:128-132` · high · sha:1b4c9a185aa5</sub>
- Keep one concept per file; when a file describes two unrelated things (e.g., a service and an unrelated cache), split it into separate files.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/12-module-organization.md:133-133` · high · sha:1b4c9a185aa5</sub>

## Constraints

## Conclusions

## Reference
- With `verbatimModuleSyntax` enabled, a plain `import` is kept in the compiled output while an `import type` is erased, so the source states the runtime module graph exactly.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/12-module-organization.md:61-61` · high · sha:1b4c9a185aa5</sub>
- Around 300 lines per file is the consider-splitting signal (a soft prompt, not a hard cap), distinct from the 70-line function cap defined elsewhere.
  <sub>styleguide · `/home/mohammad/Projects/dexpace/styleguide/typescript/12-module-organization.md:134-134` · high · sha:1b4c9a185aa5</sub>

## Conflicts

## Superseded
