import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['dist/**']
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended.map(config => ({ ...config, files: ['**/*.ts'] })),
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', {
        'argsIgnorePattern': '^_',
        'varsIgnorePattern': '^_'
      }]
    }
  },
  { files: ['scripts/**/*.cjs'], languageOptions: { sourceType: 'commonjs', globals: globals.node } },
  // This harness contains Playwright browser-evaluation callbacks as well as Node orchestration.
  { files: ['scripts/stripe-browser-gate.cjs'], languageOptions: { globals: { ...globals.node, ...globals.browser } } }
);
