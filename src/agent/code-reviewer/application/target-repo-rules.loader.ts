import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../../github/domain/port/github-client.port';
import {
  renderTargetRepoRules,
  TARGET_REPO_RULE_FILES,
  TargetRepoRules,
  TargetRepoRuleSource,
} from '../domain/target-repo-rules';

// 같은 base 커밋의 문서는 다시 받지 않는다. 스윕은 5분마다 여러 PR 을 리뷰하고, 한 레포의 열린 PR 들은
// 대개 같은 base 를 본다. 커밋 SHA 로 묶으므로 문서가 바뀌면(base 가 움직이면) 저절로 새로 받는다.
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX_ENTRIES = 100;

interface CacheEntry {
  at: number;
  rules: TargetRepoRules;
}

export interface LoadTargetRepoRulesInput {
  repo: string;
  baseSha: string;
}

interface ReadRuleFileInput extends LoadTargetRepoRulesInput {
  path: string;
}

interface CacheWriteInput {
  key: string;
  rules: TargetRepoRules;
}

@Injectable()
export class TargetRepoRulesLoader {
  private readonly logger = new Logger(TargetRepoRulesLoader.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
  ) {}

  // 문서가 없거나 조회가 실패해도 리뷰는 멈추지 않는다 — 실을 것이 없으면 빈 블록이다.
  async load({
    repo,
    baseSha,
  }: LoadTargetRepoRulesInput): Promise<TargetRepoRules> {
    const key = `${repo.toLowerCase()}@${baseSha}`;
    const cached = this.cache.get(key);
    if (cached !== undefined && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.rules;
    }
    const sources = await Promise.all(
      TARGET_REPO_RULE_FILES.map((path) =>
        this.readFile({ repo, baseSha, path }),
      ),
    );
    const rules = renderTargetRepoRules(sources.flat());
    this.remember({ key, rules });
    if (rules.used.length > 0) {
      this.logger.log(
        `대상 레포 규칙 첨부 (${repo}): ${rules.used.join(', ')}`,
      );
    }
    return rules;
  }

  // 없는 파일도 예외로 온다(404). 레포마다 있는 문서가 달라 대부분 "없음" 이라 경고로 남기지 않는다.
  // 없으면 빈 배열 — 호출부가 flat 으로 펼친다.
  private async readFile({
    repo,
    baseSha,
    path,
  }: ReadRuleFileInput): Promise<TargetRepoRuleSource[]> {
    try {
      const found = await this.githubClient.getFileFromBranch({
        repo,
        branch: baseSha,
        path,
      });
      if (found.content === undefined) {
        return [];
      }
      return [{ path, content: found.content }];
    } catch {
      return [];
    }
  }

  private remember({ key, rules }: CacheWriteInput): void {
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }
    this.cache.set(key, { at: Date.now(), rules });
  }
}
