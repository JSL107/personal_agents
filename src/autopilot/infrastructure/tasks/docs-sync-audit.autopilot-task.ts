import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  DOCS_AUDIT_PORT,
  DocsAuditPort,
} from '../../../docs-audit/domain/port/docs-audit.port';
import { PREVIEW_KIND } from '../../../preview-gate/domain/preview-action.type';
import { formatDocsAudit } from '../../../slack/format/docs-audit.formatter';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

// 주간 문서↔코드 동기화 점검 — Layer1 결정론(docs:check/check:env) + Layer2 codex 자기수정 루프.
// 읽기 전용(파일 미수정)이라 T0_AUTO. DOCS_AUDIT_ENABLED='false' 면 전체 skip.
@Injectable()
export class DocsSyncAuditTask implements AutopilotTask {
  readonly id = 'docs-sync-audit';

  constructor(
    @Inject(DOCS_AUDIT_PORT) private readonly audit: DocsAuditPort,
    private readonly configService: ConfigService,
  ) {}

  async run({
    firedAtKst,
  }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    if (this.configService.get<string>('DOCS_AUDIT_ENABLED') === 'false') {
      return { skip: true };
    }
    const result = await this.audit.runAudit();
    const summaryText = formatDocsAudit(result, firedAtKst);

    // 완전자동 게이트 ON + 적용 가능한 revision 이 있으면 preview 페이로드.
    if (
      this.configService.get<string>('DOCS_AUDIT_PR_ENABLED') === 'true' &&
      result.revision
    ) {
      const repoLabel =
        this.configService.get<string>('DOCS_AUDIT_PR_REPO')?.trim() ||
        this.configService
          .get<string>('BE_SANDBOX_DEFAULT_REPO_LABEL')
          ?.trim() ||
        'JSL107/personal_agents';
      const baseBranch =
        this.configService.get<string>('DOCS_AUDIT_PR_BASE_BRANCH')?.trim() ||
        'main';
      const payload = {
        files: result.revision.files,
        changedFiles: result.revision.changedFiles,
        rationale: result.proposals
          .filter((proposal) => proposal.confirmed)
          .map((proposal) => proposal.rationale)
          .join('\n\n'),
        repoLabel,
        baseBranch,
      };
      return {
        skip: false,
        summaryText: summaryText.length > 0 ? summaryText : undefined,
        preview: {
          kind: PREVIEW_KIND.DOCS_AUDIT_PR,
          payload,
          previewText: `${summaryText}\n\n*적용 미리보기*\n${result.revision.previewText}\n\n✅ 적용 시 docs PR 이 열립니다.`,
        },
      };
    }

    if (summaryText.length === 0) {
      return { skip: true };
    }
    return { skip: false, summaryText };
  }
}
