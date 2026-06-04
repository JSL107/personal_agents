import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AgentType } from '../../../model-router/domain/model-router.type';
import { CreatePreviewUsecase } from '../../../preview-gate/application/create-preview.usecase';
import { PREVIEW_KIND } from '../../../preview-gate/domain/preview-action.type';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../../router/domain/port/agent-dispatcher.port';
import { formatBackendPlan } from '../../../slack/format/backend-plan.formatter';
import { GenerateBackendPlanUsecase } from '../application/generate-backend-plan.usecase';
import { BackendPlan } from '../domain/be-agent.type';

// Phase 2 자동 chain — BE worker 의 BackendPlan 출력 직후 BE_SANDBOX_APPLY preview 자동 생성.
// 사용자가 "응" 입력 시 → BeSandboxApplier (Claude diff + sandbox apply + jest) → 통과 시 PR open chain.
// env `BE_AUTONOMOUS_FROM_PLAN=true` 일 때만 활성. preview TTL 30분.
const PREVIEW_TTL_MS = 30 * 60 * 1000;

// BE worker 의 Router dispatcher — 자연어 메시지 (`input.text`) 를 subject 로 매핑.
// Phase 2 자동 chain 활성 시 plan 출력 직후 preview 자동 생성 → 사용자에게 Y/N 안내.
@Injectable()
export class BeDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.BE;
  private readonly logger = new Logger(BeDispatcher.name);

  constructor(
    private readonly generateBackendPlan: GenerateBackendPlanUsecase,
    private readonly createPreviewUsecase: CreatePreviewUsecase,
    private readonly configService: ConfigService,
  ) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const outcome = await this.generateBackendPlan.execute({
      subject: input.text ?? '',
      slackUserId: input.slackUserId,
    });

    const planFormatted = formatBackendPlan(outcome.result);
    const chainNotice = await this.maybeChainSandboxPreview({
      slackUserId: input.slackUserId,
      plan: outcome.result,
    });

    return {
      agentRunId: outcome.agentRunId,
      output: outcome.result,
      modelUsed: outcome.modelUsed,
      formattedText: chainNotice
        ? `${planFormatted}\n\n${chainNotice}`
        : planFormatted,
    };
  }

  // BE_AUTONOMOUS_FROM_PLAN=true 일 때만 BE_SANDBOX_APPLY preview 자동 생성.
  // 실패 (DB 에러 등) 는 graceful — plan 자체는 사용자에게 정상 노출.
  private async maybeChainSandboxPreview({
    slackUserId,
    plan,
  }: {
    slackUserId: string;
    plan: BackendPlan;
  }): Promise<string | null> {
    const enabled =
      this.configService.get<string>('BE_AUTONOMOUS_FROM_PLAN')?.trim() ===
      'true';
    if (!enabled) {
      return null;
    }
    const repoLabel =
      this.configService.get<string>('BE_SANDBOX_DEFAULT_REPO_LABEL')?.trim() ||
      'JSL107/personal_agents';
    const baseBranch =
      this.configService
        .get<string>('BE_SANDBOX_DEFAULT_BASE_BRANCH')
        ?.trim() || 'main';

    try {
      const planText = buildPlanText(plan);
      const created = await this.createPreviewUsecase.execute({
        slackUserId,
        kind: PREVIEW_KIND.BE_SANDBOX_APPLY,
        payload: { planText, repoLabel, baseBranch },
        previewText: `BE 자율 개발 — sandbox 안 적용 + jest 검증 후 PR auto-open chain. (${repoLabel} @ ${baseBranch})`,
        responseUrl: null,
        ttlMs: PREVIEW_TTL_MS,
      });
      this.logger.log(
        `BE autonomous chain preview 생성 — previewId=${created.id} repo=${repoLabel} base=${baseBranch}`,
      );
      return `_💡 이 plan 으로 \`${repoLabel}\` (\`${baseBranch}\`) 에 자동 개발 진행할까요? **"응"** 입력하면 sandbox 검증 + PR auto-open chain 시작. ("아니" 면 plan 만 두고 종료.)_`;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`BE autonomous chain preview 생성 실패: ${message}`);
      return null;
    }
  }
}

// BackendPlan 의 핵심 필드를 LLM 친화 plan text 로 직렬화. Claude (BeDiffGenerator) 가 patch 생성 시
// 컨텍스트로 사용 — implementationChecklist / apiDesign / risks / testPoints 까지 동봉.
const buildPlanText = (plan: BackendPlan): string => {
  const sections: string[] = [];
  sections.push(`[Subject]`);
  sections.push(plan.subject);
  sections.push('');
  if (plan.context) {
    sections.push(`[Context]`);
    sections.push(plan.context);
    sections.push('');
  }
  sections.push(`[Implementation Checklist]`);
  plan.implementationChecklist.forEach((item, idx) => {
    sections.push(`${idx + 1}. ${item.title}`);
    if (item.description) {
      sections.push(`   - ${item.description}`);
    }
    if (item.dependsOn && item.dependsOn.length > 0) {
      sections.push(`   - depends on: ${item.dependsOn.join(', ')}`);
    }
  });
  sections.push('');
  if (plan.apiDesign && plan.apiDesign.length > 0) {
    sections.push(`[API Design]`);
    plan.apiDesign.forEach((api) => {
      sections.push(`- ${api.method} ${api.path}`);
      sections.push(`  request: ${api.request}`);
      sections.push(`  response: ${api.response}`);
      if (api.notes) {
        sections.push(`  notes: ${api.notes}`);
      }
    });
    sections.push('');
  }
  if (plan.risks && plan.risks.length > 0) {
    sections.push(`[Risks]`);
    plan.risks.forEach((risk) => {
      sections.push(`- ${risk}`);
    });
    sections.push('');
  }
  if (plan.testPoints && plan.testPoints.length > 0) {
    sections.push(`[Test Points]`);
    plan.testPoints.forEach((tp) => {
      sections.push(`- ${tp}`);
    });
    sections.push('');
  }
  return sections.join('\n').trim();
};
