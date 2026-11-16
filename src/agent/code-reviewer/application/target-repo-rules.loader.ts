import { Inject, Injectable, Logger } from '@nestjs/common';

import { GithubException } from '../../../github/domain/github.exception';
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

// 없는 파일은 GithubException 이 감싼 Octokit 오류의 status 404 로 온다.
const isNotFound = (error: unknown): boolean => {
  const cause = error instanceof GithubException ? error.cause : error;
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'status' in cause &&
    cause.status === 404
  );
};

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
    const reads = await Promise.all(
      TARGET_REPO_RULE_FILES.map((path) =>
        this.readFile({ repo, baseSha, path }),
      ),
    );
    const rules = renderTargetRepoRules(reads.flatMap((read) => read ?? []));
    // 일시 실패(429·5xx·네트워크)가 하나라도 있으면 담아 두지 않는다 — 다음 리뷰가 다시 받게.
    const allRead = reads.every((read) => read !== null);
    if (allRead) {
      this.remember({ key, rules });
    }
    if (rules.used.length > 0) {
      this.logger.log(
        `대상 레포 규칙 첨부 (${repo}): ${rules.used.join(', ')}`,
      );
    }
    return rules;
  }

  // 없는 파일(404)은 빈 배열이다. 레포마다 있는 문서가 달라 대부분 "없음" 이라 경고로 남기지 않는다.
  // 그 밖의 실패는 null — 이번 리뷰는 그 문서 없이 진행하되, 결과를 담아 두지 않는 신호로 쓴다.
  private async readFile({
    repo,
    baseSha,
    path,
  }: ReadRuleFileInput): Promise<TargetRepoRuleSource[] | null> {
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
    } catch (error: unknown) {
      if (isNotFound(error)) {
        return [];
      }
      this.logger.warn(
        `대상 레포 규칙 조회 실패 (${repo} ${path}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
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
