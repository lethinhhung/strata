module.exports = {
  root: true,
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'script',
  },
  env: {
    node: true,
  },
  ignorePatterns: ['dist/', 'node_modules/'],
  extends: ['eslint:recommended'],
  overrides: [{
    files: ['src/**/*.ts', 'tests/**/*.ts', 'vitest.config.ts'],
    parser: '@typescript-eslint/parser',
    parserOptions: { sourceType: 'module' },
    plugins: ['@typescript-eslint'],
    extends: ['plugin:@typescript-eslint/recommended'],
    rules: {
      // External configuration and provider responses retain their existing any boundaries.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  }],
};
