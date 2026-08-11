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
    // 게이트 OFF 도 1줄 남긴다 — skip 으로 끊으면 "꺼둬서 안 했다" 와 "점검이 죽어서 안 돌았다"
    // 가 구분되지 않는다. 주 1회 발화라 문구 1줄의 비용이 그 구분보다 작다.
    if (this.configService.get<string>('DOCS_AUDIT_ENABLED') === 'false') {
      return {
        skip: false,
        summaryText: `⏸️ *문서 점검* — ${firedAtKst} · 건너뜀 (\`DOCS_AUDIT_ENABLED=false\`)`,
      };
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

    // 드리프트 0건에도 skip 하지 않는다 — 주 1회(일 11:00) 발화라 skip 으로 끊으면 그 주에
    // 점검이 돌았는지 자체가 아무 데도 안 남는다(LLM 을 안 쓰는 구간은 agent_run 에도 없다).
    return {
      skip: false,
      summaryText:
        summaryText.length > 0
          ? summaryText
          : `✅ *문서 점검* — ${firedAtKst} · 문서↔코드 드리프트 없음 (결정론·의미 점검)`,
    };
  }
}
