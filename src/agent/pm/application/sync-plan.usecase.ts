import { Inject, Injectable } from '@nestjs/common';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { CreatePreviewUsecase } from '../../../preview-gate/application/create-preview.usecase';
import { PREVIEW_KIND } from '../../../preview-gate/domain/preview-action.type';
import { PmAgentException } from '../domain/pm-agent.exception';
import { TaskItem } from '../domain/pm-agent.type';
import { PmAgentErrorCode } from '../domain/pm-agent-error-code.enum';
import { coerceToDailyPlan } from '../domain/prompt/previous-plan-formatter';

const ONE_HOUR_MS = 60 * 60 * 1000;

export interface SyncPlanResult {
  previewId: string;
  previewText: string;
  candidateCount: number;
}

// PM-2: 직전 PM `/today` plan 의 GITHUB/NOTION task 들을 외부 시스템에 동기화하기 위해 PreviewAction 생성.
// 사용자 ✅ 클릭하면 PmWriteBackApplier 가 코멘트/Todo append 수행.
// 후보가 없으면 (subtasks 없거나 GITHUB/NOTION source 가 없음) 명시 예외로 끊는다.
@Injectable()
export class SyncPlanUsecase {
  constructor(
    @Inject(AgentRunService)
    private readonly agentRunService: AgentRunService,
    @Inject(CreatePreviewUsecase)
    private readonly createPreviewUsecase: CreatePreviewUsecase,
  ) {}

  async execute({
    slackUserId,
  }: {
    slackUserId: string;
  }): Promise<SyncPlanResult> {
    const snapshot = await this.agentRunService.findLatestSucceededRun({
      agentType: AgentType.PM,
      slackUserId,
    });
    if (!snapshot) {
      throw new PmAgentException({
        code: PmAgentErrorCode.NO_RECENT_PLAN,
        message:
          '동기화할 직전 PM 실행이 없습니다. 먼저 `/today` 로 plan 을 생성한 뒤 다시 시도해주세요.',
        status: DomainStatus.PRECONDITION_FAILED,
      });
    }
    const plan = coerceToDailyPlan(snapshot.output);
    if (!plan) {
      throw new PmAgentException({
        code: PmAgentErrorCode.NO_RECENT_PLAN,
        message:
          '직전 PM 실행 결과를 DailyPlan 으로 해석할 수 없습니다 (구버전 출력). 새로운 `/today` 실행 후 다시 시도해주세요.',
        status: DomainStatus.PRECONDITION_FAILED,
      });
    }

    const candidates = collectWriteBackCandidates(plan);
    if (candidates.length === 0) {
      throw new PmAgentException({
        code: PmAgentErrorCode.NO_WRITE_BACK_CANDIDATES,
        message:
          '동기화할 GITHUB/NOTION task 가 없습니다 (subtasks 가 비어있거나 source 가 사용자 입력만 있음).',
        status: DomainStatus.BAD_REQUEST,
      });
    }

    const previewText = buildPreviewText(candidates);
    const preview = await this.createPreviewUsecase.execute({
      slackUserId,
      kind: PREVIEW_KIND.PM_WRITE_BACK,
      payload: { tasks: candidates },
      previewText,
      responseUrl: null,
      ttlMs: ONE_HOUR_MS,
    });
    return {
      previewId: preview.id,
      previewText,
      candidateCount: candidates.length,
    };
  }
}

// DailyPlan 에서 GITHUB/NOTION source + subtasks 비어있지 않은 task 만 추출.
// topPriority + morning + afternoon 모두 후보. ROLLOVER 도 source 가 GITHUB/NOTION 이면 포함 (자연 키 동일).
const collectWriteBackCandidates = (plan: {
  topPriority: TaskItem;
  morning: TaskItem[];
  afternoon: TaskItem[];
}): TaskItem[] => {
  const all = [plan.topPriority, ...plan.morning, ...plan.afternoon];
  return all.filter(
    (task) =>
      (task.source === 'GITHUB' || task.source === 'NOTION') &&
      task.subtasks.length > 0,
  );
};

const buildPreviewText = (tasks: TaskItem[]): string => {
  const lines: string[] = [
    '*PM Write-back 동기화 미리보기*',
    '',
    `다음 ${tasks.length}개 task 에 WBS subtasks 가 동기화됩니다 — ✅ 적용 / ❌ 취소 를 눌러주세요.`,
    '',
  ];
  for (const task of tasks) {
    const where = task.source === 'GITHUB' ? 'GitHub Issue' : 'Notion page';
    lines.push(`*${where} — ${task.title}* (${task.id})`);
    for (const sub of task.subtasks) {
      lines.push(`  ↳ ${sub.title} (${sub.estimatedMinutes}m)`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
};
