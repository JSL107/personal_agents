import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DomainStatus } from '../../../common/exception/domain-status.enum';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../../github/domain/port/github-client.port';
import { ApplyResult } from '../../../preview-gate/domain/apply-result.type';
import { PreviewApplier } from '../../../preview-gate/domain/port/preview-applier.port';
import { PreviewActionException } from '../../../preview-gate/domain/preview-action.exception';
import {
  PREVIEW_KIND,
  PreviewAction,
  PreviewKind,
} from '../../../preview-gate/domain/preview-action.type';
import { PreviewActionErrorCode } from '../../../preview-gate/domain/preview-action-error-code.enum';
import {
  isBeSandboxPushPrPayload,
  parseRepoLabel,
} from '../domain/be-sandbox-push-pr.type';
import { applyDiffAndReadFiles } from './be-sandbox-diff-apply.helper';

const DIFF_TAIL_LIMIT = 2_000;
const PR_TITLE_CAP = 80;
const PR_BODY_CAP = 4_000;
const COMMIT_SUBJECT_CAP = 72;

// PreviewKind.BE_SANDBOX_PUSH_PR strategy — Phase 2b-2 실제 PR open.
// 흐름:
//   1) payload validation
//   2) 호스트 tmp 디렉토리에 diff 적용 → 변경된 file 의 새 content 회복 (applyDiffAndReadFiles)
//   3) octokit Git Data API 로 새 branch + 1 commit + PR open (githubClient.pushBranchAndOpenPr)
//   4) PR URL 반환
//
// 보안 / 격리:
// - host 작업 트리는 절대 변경 X — 임시 tmp 디렉토리에 git clone 후 거기서만 apply
// - GITHUB_TOKEN 은 OctokitGithubClient 내부에서만 사용
// - main 직접 push 절대 X — 항상 새 branch (`feat/idaeri-<slug>-<ts>`)
@Injectable()
export class BeSandboxPushPrApplier implements PreviewApplier {
  readonly kind: PreviewKind = PREVIEW_KIND.BE_SANDBOX_PUSH_PR;
  private readonly logger = new Logger(BeSandboxPushPrApplier.name);

  constructor(
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
    private readonly configService: ConfigService,
  ) {}

  async apply(preview: PreviewAction): Promise<ApplyResult> {
    if (!isBeSandboxPushPrPayload(preview.payload)) {
      throw new PreviewActionException({
        code: PreviewActionErrorCode.NO_APPLIER_FOR_KIND,
        message:
          'BE_SANDBOX_PUSH_PR payload 형식이 BeSandboxPushPrPayload 와 맞지 않습니다.',
        status: DomainStatus.INTERNAL,
      });
    }

    const { diff, reasoning, changedFiles, repoLabel, baseBranch } =
      preview.payload;
    const { owner, repo } = parseRepoLabel(repoLabel);

    const hostRepoPath =
      this.configService.get<string>('BE_SANDBOX_HOST_REPO_PATH')?.trim() ||
      process.cwd();

    // 1) host tmp 에 diff 적용 → 변경된 file 의 새 content 회복.
    let fileContents: Map<string, string>;
    try {
      fileContents = await applyDiffAndReadFiles({
        hostRepoPath,
        diff,
        changedFiles,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`BE PR push — host tmp diff apply 실패: ${message}`);
      throw new PreviewActionException({
        code: PreviewActionErrorCode.NO_APPLIER_FOR_KIND,
        message: `diff 를 호스트 tmp 에 적용할 수 없습니다: ${message.slice(0, 300)}`,
        status: DomainStatus.BAD_REQUEST,
      });
    }

    // 2) octokit Git Data API push.
    const branchName = buildBranchName(changedFiles);
    const commitMessage = buildCommitMessage(reasoning);
    const prTitle = buildPrTitle(reasoning);
    const prBody = buildPrBody({ reasoning, changedFiles, branchName });

    const files = [...fileContents.entries()].map(([path, content]) => ({
      path,
      content,
    }));

    try {
      const result = await this.githubClient.pushBranchAndOpenPr({
        repo: repoLabel,
        baseBranch,
        branchName,
        commitMessage,
        files,
        prTitle,
        prBody,
      });

      this.logger.log(
        `BE PR auto-open 성공 — ${owner}/${repo} PR #${result.prNumber} (${result.prUrl})`,
      );

      const diffSnippet =
        diff.length > DIFF_TAIL_LIMIT
          ? `${diff.slice(0, DIFF_TAIL_LIMIT)}\n... (생략됨 — diff cap ${DIFF_TAIL_LIMIT} bytes)`
          : diff;

      const message = [
        `🚀 *BE Sandbox Push PR — Phase 2b-2 완료*`,
        '',
        `• 대상 repo: ${owner}/${repo}`,
        `• 베이스 브랜치: \`${baseBranch}\``,
        `• 새 브랜치: \`${branchName}\``,
        `• 변경 파일 (${changedFiles.length}건): ${changedFiles.join(', ')}`,
        `• Commit SHA: \`${result.commitSha.slice(0, 12)}\``,
        '',
        `*PR* — <${result.prUrl}|#${result.prNumber} ${prTitle}>`,
        '',
        `*Reasoning*`,
        reasoning,
        '',
        `*Diff*`,
        '```diff',
        diffSnippet,
        '```',
        '',
        '_Phase 2b-2 — 새 branch + 1 commit + PR open 완료. main 직접 push 0. 머지는 사용자 수동._',
      ].join('\n');

      // 가장 위험한 외부 부작용(코드 push + PR open) — ResultVerifier 가 getPullRequest 로
      // PR 이 실제 열렸는지 재조회 검증한다.
      return {
        message,
        artifacts: [
          { type: 'github_pr', repo: repoLabel, prNumber: result.prNumber },
        ],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`BE PR auto-open 실패 — ${owner}/${repo}: ${message}`);
      throw new PreviewActionException({
        code: PreviewActionErrorCode.NO_APPLIER_FOR_KIND,
        message: `GitHub PR open 실패: ${message.slice(0, 300)}`,
        status: DomainStatus.BAD_GATEWAY,
      });
    }
  }
}

const buildBranchName = (changedFiles: string[]): string => {
  const firstFile = changedFiles[0] ?? 'change';
  const basename = firstFile.split('/').pop() ?? 'change';
  const slug = basename
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .toLowerCase();
  return `feat/idaeri-${slug || 'change'}-${Date.now()}`;
};

const buildCommitMessage = (reasoning: string): string => {
  const trimmed = reasoning.trim();
  const subject =
    trimmed.length > COMMIT_SUBJECT_CAP
      ? `${trimmed.slice(0, COMMIT_SUBJECT_CAP - 1)}…`
      : trimmed;
  return `feat(idaeri): ${subject}\n\n${trimmed}`;
};

const buildPrTitle = (reasoning: string): string => {
  const trimmed = reasoning.trim();
  return trimmed.length > PR_TITLE_CAP
    ? `${trimmed.slice(0, PR_TITLE_CAP - 1)}…`
    : trimmed;
};

const buildPrBody = ({
  reasoning,
  changedFiles,
  branchName,
}: {
  reasoning: string;
  changedFiles: string[];
  branchName: string;
}): string => {
  const truncatedReasoning =
    reasoning.length > PR_BODY_CAP
      ? `${reasoning.slice(0, PR_BODY_CAP)}\n...`
      : reasoning;
  return [
    `## 자동 생성 — 이대리 (Phase 2b-2)`,
    '',
    `**branch**: \`${branchName}\``,
    `**변경 파일**: ${changedFiles.map((f) => `\`${f}\``).join(', ')}`,
    '',
    `## Reasoning`,
    truncatedReasoning,
    '',
    `_본 PR 은 BE 자율 개발 흐름의 sandbox 안 jest 통과 후 사용자 ✅ 확인을 거쳐 자동 생성됐습니다. 머지 전 사용자 검토 필수._`,
  ].join('\n');
};
