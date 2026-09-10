import eslintConfigPrettier from 'eslint-config-prettier/flat';
import prettierRecommended from 'eslint-plugin-prettier/recommended';
import tseslint from 'typescript-eslint';

/**
 * What the project has always linted with - @typescript-eslint's recommended set,
 * with prettier deciding formatting. The tooling underneath is what changed:
 * @typescript-eslint 4 predates decorator scope analysis, so every `Module`,
 * `Injectable` and `InjectModel` counted as an unused import and the run answered
 * with hundreds of warnings that were all the same non-finding, with nowhere for
 * a real one to be seen.
 *
 * Three overrides the old config carried are gone because the rules they name no
 * longer exist (`no-parameter-properties`, `interface-name-prefix`, `ban-types`)
 * and three more because recommended does not turn their rules on in the first
 * place (`explicit-member-accessibility`, `explicit-function-return-type`,
 * `explicit-module-boundary-types`). `no-var-requires` became
 * `no-require-imports`, which stays on: the two files that do need a `require`
 * say so on the line.
 */
export default tseslint.config({ ignores: ['dist/', 'logs/'] }, tseslint.configs.recommended, eslintConfigPrettier, prettierRecommended, {
  rules: {
    // The codebase uses `any` where a type would be a guess; that is a
    // decision, not something to be reported 200 times.
    '@typescript-eslint/no-explicit-any': 'off',
    // A leading underscore is how this codebase says a binding exists only to
    // be skipped - a parameter an interface dictates, an array slot, a field
    // destructured away so the rest can be passed on. Reporting those is the
    // rule misreading the convention; anything else unused is dead.
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
  },
});
