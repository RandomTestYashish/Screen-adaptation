/* eslint-env node */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
  plugins: ['@typescript-eslint', 'react-hooks'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'plugin:react-hooks/recommended'],
  env: { browser: true, node: true, es2022: true },
  ignorePatterns: ['dist/', 'node_modules/', 'coverage/', '*.config.ts', '*.config.js', '*.cjs', '*.mjs', 'apps/api/prisma/'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'inline-type-imports' }],
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    eqeqeq: ['error', 'smart'],
    // Effects in this app coordinate render + validate across panes; the
    // dependency lists are deliberate and annotated where they are narrowed.
    'react-hooks/exhaustive-deps': 'warn',
  },
  overrides: [
    {
      /*
       * NestJS resolves constructor dependencies from the runtime metadata
       * `emitDecoratorMetadata` produces, which needs a real import binding for
       * every injected class. `consistent-type-imports` cannot see that a class
       * is used as a DI token and will rewrite the import to `import type`,
       * erasing it and breaking dependency injection at boot. The rule is
       * therefore off for the API, where it is actively unsafe.
       */
      files: ['apps/api/**/*.ts', 'apps/worker/**/*.ts'],
      rules: { '@typescript-eslint/consistent-type-imports': 'off' },
    },
    {
      // Scripts and tests legitimately log and assert loosely.
      files: ['**/scripts/**', '**/__tests__/**', 'e2e/**'],
      rules: { 'no-console': 'off', '@typescript-eslint/no-non-null-assertion': 'off' },
    },
  ],
};
