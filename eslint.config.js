import {createRequire} from 'node:module';
import tseslint from 'typescript-eslint';
import gts from 'gts';
import globals from 'globals';
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments';

// gts enables `prettier/prettier` with no inline options — its actual style
// lives in `gts/.prettierrc.json`, which Prettier resolves by walking up from
// each linted file. This repo deliberately has no root Prettier config (the one
// `eslint.config.js` is the only overlay), so that lookup never finds gts's
// file and Prettier silently falls back to its own defaults — double quotes,
// bracket spacing, the lot. Reading gts's own file is what `gts init`'s
// generated `.prettierrc.js` does; sourcing it here keeps the single-overlay
// rule without pinning a copy that drifts on the next gts release.
const require = createRequire(import.meta.url);
const gtsPrettierOptions = require('gts/.prettierrc.json');

export default tseslint.config(
  {ignores: ['**/dist/**', '**/build/**']},
  ...gts,
  {
    rules: {'prettier/prettier': ['error', gtsPrettierOptions]},
  },
  {
    // The root config, the `.mjs` verification scripts, the Node-runtime
    // conformance suite, and the `.claude/skills` runners belong to no
    // TypeScript project; they get the
    // gts/format baseline only, never the type-aware tiers below. gts scopes
    // its own Node globals to a fixed list of filenames that includes none of
    // these, so declare them here or `console`/`URL` trip `no-undef` — and, in
    // the conformance suite, so do the Web Streams and `AbortSignal` globals
    // that are the whole point of running it on Node.
    files: [
      'eslint.config.js',
      'scripts/*.mjs',
      'packages/*/scripts/*.mjs',
      'test/node-conformance/*.mjs',
      '.claude/skills/*/*.mjs',
    ],
    languageOptions: {sourceType: 'module', globals: globals.node},
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    plugins: {'@eslint-community/eslint-comments': eslintComments},
    languageOptions: {
      parserOptions: {
        project: null,
        projectService: true,
      },
    },
    rules: {
      'max-lines-per-function': [
        'error',
        {max: 70, skipComments: true, skipBlankLines: false},
      ],
      'max-depth': ['error', 3],
      'max-params': ['error', 3],
      // Explicit API surface — the design doc's gate table (Components §3) names both of these.
      // `allowExpressions: true` exempts inline callback arrows (test callbacks, `.map(e => ...)`)
      // so the rule only bites named/exported functions and methods, which is where the surface lives.
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        {allowExpressions: true},
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      // Every `eslint-disable` must carry a `-- reason` (NFR-7's documented-exception clause).
      '@eslint-community/eslint-comments/require-description': 'error',
      // lib.dom (added for the seam surface's AbortSignal/AbortController/DOMException) declares
      // global Request/Response/Headers/window/document. A core file that forgets its own import no
      // longer fails to compile — it silently type-checks against the DOM global instead. An
      // imported binding shadows the global, so correctly-importing files are unaffected.
      'no-restricted-globals': [
        'error',
        {
          name: 'Request',
          message:
            'lib.dom global — import Request from src/http/request.js instead.',
        },
        {
          name: 'Response',
          message:
            'lib.dom global — import Response from src/http/response.js instead.',
        },
        {
          name: 'Headers',
          message:
            'lib.dom global — import Headers from src/http/headers.js instead.',
        },
        {
          name: 'window',
          message: 'Browser-only global; @dexpace/core is runtime-agnostic.',
        },
        {
          name: 'document',
          message: 'Browser-only global; @dexpace/core is runtime-agnostic.',
        },
      ],
    },
  },
);
