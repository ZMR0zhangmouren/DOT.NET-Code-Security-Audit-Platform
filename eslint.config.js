// ESLint v9 flat config —— 跨 apps/api (Node) 与 apps/web (Browser) 的统一规则
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      'coverage/**',
      '.claude/**',
      'dotnet-security-audit-skill/**',
      'output/**',
      'storage/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // 通用 TS 规则
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    plugins: {
      import: importPlugin,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      eqeqeq: ['error', 'always'],
      'import/order': ['warn', { 'newlines-between': 'always', alphabetize: { order: 'asc' } }],
    },
  },

  // 测试文件放宽
  {
    files: ['**/*.spec.ts', '**/*.test.ts', '**/*.spec.tsx', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },

  // 配置文件用 CommonJS 也行
  {
    files: ['*.config.{js,mjs,cjs,ts}', 'vitest.config.*', 'vite.config.*'],
    languageOptions: {
      sourceType: 'module',
    },
  },

  // 必须在最后:关闭与 Prettier 冲突的规则
  prettier,
];
