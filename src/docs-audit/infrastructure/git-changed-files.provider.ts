import { Injectable } from '@nestjs/common';

import { CommandRunner } from './deterministic-docs.checker';

// 문서 드리프트를 잘 일으키는 SoT 파일 화이트리스트 — sync-docs.ts 의 생성 소스와 일치.
const SOT_WHITELIST: readonly string[] = [
  'src/agent-registry/agent-registry.ts',
  'src/config/app.config.ts',
  'src/model-router/application/model-router.usecase.ts',
];

// Task 7 모듈에서 DeterministicDocsChecker 와 동일한 공유 runner 를 주입한다 — 미주입 시 즉시 실패.
const DEFAULT_GIT_RUNNER: CommandRunner = () =>
  Promise.reject(new Error('GitChangedFilesProvider 는 runner 주입 필요'));

@Injectable()
export class GitChangedFilesProvider {
  constructor(private readonly runner: CommandRunner = DEFAULT_GIT_RUNNER) {}

  async recentlyChangedSotFiles(maxFiles: number): Promise<string[]> {
    const result = await this.runner('git', [
      'log',
      '--since=7 days ago',
      '--name-only',
      '--pretty=format:',
    ]);
    if (result.exitCode !== 0) {
      return [];
    }
    const changed = new Set(
      result.output
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    );
    return SOT_WHITELIST.filter((path) => changed.has(path)).slice(0, maxFiles);
  }
}
