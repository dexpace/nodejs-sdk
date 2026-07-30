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
    // The root config and the `.mjs` verification scripts belong to no
    // TypeScript project; they get the gts/format baseline only, never the
    // type-aware tiers below. gts scopes its own Node globals to a fixed list
    // of filenames that does not include `scripts/*.mjs`, so declare them here
    // or `console`/`URL` trip `no-undef`.
    files: ['eslint.config.js', 'scripts/*.mjs'],
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
    },
  },
);
