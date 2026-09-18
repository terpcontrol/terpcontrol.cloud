import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import prettierRecommended from 'eslint-plugin-prettier/recommended';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * The server's discipline, plus what React adds: the rules of hooks, and the
 * one that keeps a module from exporting a component beside something else,
 * which is what breaks fast refresh.
 *
 * The two overrides are the server's, for the same reasons: `any` is used where
 * a type would be a guess, and a leading underscore is how this codebase says a
 * binding exists only to be skipped.
 */
export default tseslint.config(
  { ignores: ['dist/', 'dev-dist/', 'public/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  reactHooks.configs.flat['recommended-latest'],
  eslintConfigPrettier,
  prettierRecommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-refresh': reactRefresh },
    rules: {
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      // Every shape on the wire is the contract's. Importing one as a value
      // would pull `@fg2/shared-types/v1` into the bundle, and it has nothing in it.
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
    },
  },
);
