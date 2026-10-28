// 변이 검사(Stryker) — CI 가 아니라 중요한 도메인 로직을 고친 뒤 파일 하나에 수동으로 돌린다.
// 사용: pnpm mutate src/agent/po-shadow/domain/product-goal.facts.ts (같은 폴더의 *.spec.ts 만 돈다)
//
// 대상은 `--mutate` 인자에서 읽는다. 대상 없이 돌리면 src 전체를 변이시켜 몇 시간이 걸리므로 막는다.
const mutateIndex = process.argv.findIndex(
  (arg) => arg === '--mutate' || arg === '-m',
);
const target = mutateIndex === -1 ? undefined : process.argv[mutateIndex + 1];
if (!target?.endsWith('.ts') || target.endsWith('.spec.ts')) {
  throw new Error(
    '변이 대상 .ts 파일 하나를 넘겨야 한다: pnpm mutate src/<경로>/<파일>.ts',
  );
}
const specFromSrc = target
  .replace(/^(\.\/)?src\//, '')
  .replace(/\.ts$/, '.spec.ts');
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export default {
  testRunner: 'jest',
  // pnpm 은 플러그인을 core 옆에 두지 않아 자동 탐색이 실패한다 — 명시해야 한다.
  plugins: [
    '@stryker-mutator/jest-runner',
    '@stryker-mutator/typescript-checker',
  ],
  // 컴파일 안 되는 변이를 "생존" 이 아니라 CompileError 로 분리한다 — 없으면 점수가 낮게 왜곡된다.
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.json',
  coverageAnalysis: 'perTest',
  // 기본값(코어 수 - 1)은 부하가 있는 PC 에서 Timeout 을 폭증시켜 점수를 부풀린다(실측 55건 → 아래 값에서 재측정).
  concurrency: 4,
  // package.json 의 jest 블록 위에 얕게 덮인다. 대상 spec 만 돌려야 파일 하나에 몇 분으로 끝난다.
  jest: {
    config: { testRegex: `${escapeRegex(specFromSrc)}$` },
  },
  reporters: ['clear-text', 'html', 'json', 'progress'],
  htmlReporter: { fileName: 'reports/mutation/mutation.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  tempDirName: '.stryker-tmp',
};
