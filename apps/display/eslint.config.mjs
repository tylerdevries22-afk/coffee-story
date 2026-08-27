// @ts-check
import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * The display's own lint, because it is its own app.
 *
 * The root config is `eslint-config-expo` -- right for the two React Native
 * surfaces, wrong for a Next server-rendered one. Until this existed the
 * package script was `next lint --max-warnings=0 || echo 'lint unavailable'`,
 * which is not a lint gate: the `||` swallows every failure, so `pnpm lint`
 * has been reporting success on a file it never checked. The global standard
 * is zero warnings before a file is done; a script that cannot fail cannot
 * enforce it.
 *
 * `next lint` itself is deprecated in Next 15, so this drives ESLint directly.
 */
export default [
  {
    ignores: ['.next/**', '.next-dev/**', 'node_modules/**', 'next-env.d.ts'],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        fetch: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        window: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        URL: 'readonly',
        React: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,

      // TS already reports these, and its version understands types.
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      // Rule: no `any` without a comment saying why (global standards). The
      // codebase has none here, so this is a gate rather than a cleanup.
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
];
