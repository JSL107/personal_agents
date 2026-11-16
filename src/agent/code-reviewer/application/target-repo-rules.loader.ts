import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Inject, Injectable, Logger } from '@nestjs/common';

import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { GithubException } from '../../../github/domain/github.exception';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../../github/domain/port/github-client.port';
import {
  renderTargetRepoRules,
  renderTargetRepoRuleSections,
  TARGET_REPO_RULE_FILES,
  TargetRepoRules,
  TargetRepoRuleSection,
  TargetRepoRuleSource,
} from '../domain/target-repo-rules';

// 같은 base 커밋의 문서는 다시 받지 않는다. 스윕은 5분마다 여러 PR 을 리뷰하고, 한 레포의 열린 PR 들은
// 대개 같은 base 를 본다. 커밋 SHA 로 묶으므로 문서가 바뀌면(base 가 움직이면) 저절로 새로 받는다.
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX_ENTRIES = 100;

// GitHub 클라이언트가 없는 파일(404)을 NOT_FOUND 로 구분해 던진다.
const isNotFound = (error: unknown): boolean =>
  error instanceof GithubException && error.status === DomainStatus.NOT_FOUND;

// owner/repo 형식만 파일 경로로 쓴다 — `..` 같은 값이 개인 규칙 폴더 밖을 가리키지 않게.
const REPO_PATH_PATTERN = /^[\w.-]+\/[\w.-]+$/;
const isSafeRepoPath = (repo: string): boolean =>
  REPO_PATH_PATTERN.test(repo) &&
  repo.split('/').every((part) => part !== '.' && part !== '..');

interface CacheEntry {
  at: number;
  sections: TargetRepoRuleSection[];
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
  sections: TargetRepoRuleSection[];
}

@Injectable()
export class TargetRepoRulesLoader {
  private readonly logger = new Logger(TargetRepoRulesLoader.name);
  private readonly cache = new Map<string, CacheEntry>();
  // 개인 규칙 폴더. `<owner>/<repo>.md`(소문자)를 두면 그 레포 리뷰에 싣는다. 레포에 커밋하지 않는 나만의 기준이다.
  private readonly personalRulesDir = join(
    homedir(),
    '.idaeri',
    'review-rules',
  );

  constructor(
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
  ) {}

  // 문서가 없거나 조회가 실패해도 리뷰는 멈추지 않는다 — 실을 것이 없으면 빈 블록이다.
  async load({
    repo,
    baseSha,
  }: LoadTargetRepoRulesInput): Promise<TargetRepoRules> {
    // 개인 규칙은 로컬 파일이라 매번 읽는다 — 고친 내용이 다음 리뷰에 바로 반영되게.
    const [sections, personal] = await Promise.all([
      this.loadRepoSections({ repo, baseSha }),
      this.readPersonalRules(repo),
    ]);
    const rules = renderTargetRepoRules({ sections, personal });
    if (rules.used.length > 0) {
      this.logger.log(
        `대상 레포 규칙 첨부 (${repo}): ${rules.used.join(', ')}`,
      );
    }
    return rules;
  }

  // 문서 원문이 아니라 고른 절만 담아 둔다 — 원문은 수십 KB 라 100건이면 메모리가 커진다.
  private async loadRepoSections({
    repo,
    baseSha,
  }: LoadTargetRepoRulesInput): Promise<TargetRepoRuleSection[]> {
    const key = `${repo.toLowerCase()}@${baseSha}`;
    const cached = this.cache.get(key);
    if (cached !== undefined && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.sections;
    }
    const reads = await Promise.all(
      TARGET_REPO_RULE_FILES.map((path) =>
        this.readFile({ repo, baseSha, path }),
      ),
    );
    const sections = renderTargetRepoRuleSections(
      reads.flatMap((read) => read ?? []),
    );
    // 일시 실패(429·5xx·네트워크)가 하나라도 있으면 담아 두지 않는다 — 다음 리뷰가 다시 받게.
    const allRead = reads.every((read) => read !== null);
    if (allRead) {
      this.remember({ key, sections });
    }
    return sections;
  }

  // 파일이 없으면 개인 규칙 없이 리뷰한다. 대부분의 레포는 없으므로 경고로 남기지 않는다.
  // 있는데 못 읽은 경우(권한·폴더 등)만 경고한다.
  private async readPersonalRules(repo: string): Promise<string | undefined> {
    if (!isSafeRepoPath(repo)) {
      return undefined;
    }
    const path = join(this.personalRulesDir, `${repo.toLowerCase()}.md`);
    if (!existsSync(path)) {
      return undefined;
    }
    try {
      return await readFile(path, 'utf-8');
    } catch (error: unknown) {
      this.logger.warn(
        `개인 리뷰 규칙 읽기 실패 (${path}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
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

  private remember({ key, sections }: CacheWriteInput): void {
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }
    this.cache.set(key, { at: Date.now(), sections });
  }
}
