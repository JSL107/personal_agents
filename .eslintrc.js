module.exports = {
  root: true,
  env: {
    node: true,
    jest: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'prettier', 'simple-import-sort'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  ignorePatterns: ['dist', 'coverage', 'node_modules'],
  rules: {
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
    'curly': ['error', 'all'],
    'simple-import-sort/imports': 'error',
    'simple-import-sort/exports': 'error',
  },
  overrides: [
    {
      // CODE_RULES §3-8 — 필드는 명시 타입으로 적는다. 파생이 필요하면 작은 타입을 먼저 두고 큰 타입이 확장한다.
      files: ['src/**/*.ts', 'scripts/**/*.ts'],
      excludedFiles: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: 'TSTypeReference[typeName.name=/^(Pick|Omit)$/]',
            message:
              'Pick/Omit 대신 명시 타입을 쓴다. 파생 타입은 작은 타입을 먼저 정의하고 큰 타입이 extends 한다 (CODE_RULES §3-8).',
          },
          {
            // `interface X extends Omit<...>` 는 TSTypeReference 가 아니라 heritage 노드라 따로 잡는다.
            selector: 'TSInterfaceHeritage[expression.name=/^(Pick|Omit)$/]',
            message:
              'Pick/Omit 대신 명시 타입을 쓴다. 파생 타입은 작은 타입을 먼저 정의하고 큰 타입이 extends 한다 (CODE_RULES §3-8).',
          },
        ],
      },
    },
  ],
};
