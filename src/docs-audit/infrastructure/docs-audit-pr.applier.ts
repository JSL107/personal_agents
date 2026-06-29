import { Inject, Injectable, Logger } from '@nestjs/common';

import { DomainStatus } from '../../common/exception/domain-status.enum';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../github/domain/port/github-client.port';
import { ApplyResult } from '../../preview-gate/domain/apply-result.type';
import { PreviewApplier } from '../../preview-gate/domain/port/preview-applier.port';
import { PreviewActionException } from '../../preview-gate/domain/preview-action.exception';
import {
  PREVIEW_KIND,
  PreviewAction,
  PreviewKind,
} from '../../preview-gate/domain/preview-action.type';
import { PreviewActionErrorCode } from '../../preview-gate/domain/preview-action-error-code.enum';
import {
  isDocsAuditPrPayload,
  parseRepoLabel,
} from '../domain/docs-audit-pr.type';

const PR_BODY_CAP = 4_000;

// PreviewKind.DOCS_AUDIT_PR strategy — 확정 문서 수정 제안을 docs PR 로 open.
// content 를 이미 보유(DocsRevisionApplier 산출)하므로 diff 적용 단계 없이 pushBranchAndOpenPr 에 직접 전달.
// main 직접 push 절대 X — 항상 새 branch.
@Injectable()
export class DocsAuditPrApplier implements PreviewApplier {
  readonly kind: PreviewKind = PREVIEW_KIND.DOCS_AUDIT_PR;
  private readonly logger = new Logger(DocsAuditPrApplier.name);

  constructor(
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
  ) {}

  async apply(preview: PreviewAction): Promise<ApplyResult> {
    if (!isDocsAuditPrPayload(preview.payload)) {
      throw new PreviewActionException({
        code: PreviewActionErrorCode.NO_APPLIER_FOR_KIND,
        message: 'DOCS_AUDIT_PR payload 형식이 맞지 않습니다.',
        status: DomainStatus.INTERNAL,
      });
    }
    const { files, changedFiles, rationale, repoLabel, baseBranch } =
      preview.payload;
    const { owner, repo } = parseRepoLabel(repoLabel);
    const branchName = `docs/idaeri-docs-sync-${preview.id}`;
    const prTitle = `docs: 문서↔코드 동기화 (docs-sync-audit) — ${changedFiles.join(', ')}`;
    const commitMessage = `docs(sync): docs-sync-audit 자동 제안\n\n${rationale.slice(0, PR_BODY_CAP)}`;
    const prBody = buildPrBody({ rationale, changedFiles, branchName });

    try {
      const result = await this.githubClient.pushBranchAndOpenPr({
        repo: repoLabel,
        baseBranch,
        branchName,
        commitMessage,
        files,
        prTitle: prTitle.slice(0, 80),
        prBody,
      });
      this.logger.log(
        `docs-sync-audit PR open — ${owner}/${repo} #${result.prNumber} (${result.prUrl})`,
      );
      const message = [
        '📄 *docs-sync-audit — 문서 동기화 PR 생성됨*',
        '',
        `• 대상: ${owner}/${repo} (base \`${baseBranch}\`)`,
        `• 변경 파일: ${changedFiles.join(', ')}`,
        `*PR* — <${result.prUrl}|#${result.prNumber}>`,
        '',
        '_머지 전 사용자 검토 필수._',
      ].join('\n');
      return {
        message,
        artifacts: [
          { type: 'github_pr', repo: repoLabel, prNumber: result.prNumber },
        ],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `docs-sync-audit PR open 실패 — ${owner}/${repo}: ${message}`,
      );
      throw new PreviewActionException({
        code: PreviewActionErrorCode.NO_APPLIER_FOR_KIND,
        message: `docs PR open 실패: ${message.slice(0, 300)}`,
        status: DomainStatus.BAD_GATEWAY,
      });
    }
  }
}

function buildPrBody({
  rationale,
  changedFiles,
  branchName,
}: {
  rationale: string;
  changedFiles: string[];
  branchName: string;
}): string {
  return [
    '## 자동 생성 — 이대리 docs-sync-audit (Phase 2)',
    '',
    `**branch**: \`${branchName}\``,
    `**변경 파일**: ${changedFiles.map((file) => `\`${file}\``).join(', ')}`,
    '',
    '## 변경 근거',
    rationale.slice(0, PR_BODY_CAP),
    '',
    '_문서↔코드 동기화 점검(evaluator 확정)을 사용자 ✅ 승인 후 자동 PR. 머지 전 검토 필수._',
  ].join('\n');
}
