import { Inject, Injectable, Logger } from '@nestjs/common';

import { extractJsonObjectText } from '../../../common/util/llm-json-extract.util';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { CancelPreviewUsecase } from '../../../preview-gate/application/cancel-preview.usecase';
import { CreatePreviewUsecase } from '../../../preview-gate/application/create-preview.usecase';
import {
  PREVIEW_ACTION_REPOSITORY_PORT,
  PreviewActionRepositoryPort,
} from '../../../preview-gate/domain/port/preview-action.repository.port';
import {
  PREVIEW_KIND,
  PREVIEW_STATUS,
} from '../../../preview-gate/domain/preview-action.type';
import { todayInKst } from '../../../schedule/domain/parse-due-date';
import { escapeSlackMrkdwn } from '../../../slack/format/mrkdwn.util';
import {
  formatGoalCreatePreview,
  formatGoalProblem,
} from '../../../slack/format/product-goal.formatter';
import {
  GOAL_QUESTION_REPOSITORY_PORT,
  GoalQuestionRepositoryPort,
} from '../domain/port/goal-question.repository.port';
import {
  PRODUCT_GOAL_REPOSITORY_PORT,
  ProductGoalRepositoryPort,
} from '../domain/port/product-goal.repository.port';
import {
  extractTitleKeywords,
  findGoalDeclarationProblem,
  GOAL_PREVIEW_TTL_MS,
  parseProductGoalCommand,
  ProductGoalDraft,
  readProductGoalDraft,
} from '../domain/product-goal';
import {
  buildGoalDraftPrompt,
  GOAL_DRAFT_OUTPUT_SCHEMA,
  GOAL_DRAFT_SYSTEM_PROMPT,
} from '../domain/prompt/goal-draft.prompt';

const RETRY_TEXT = '🧭 지금 정리가 잘 안 됐어요. 한 번만 다시 말해 주시겠어요?';
const DECLINE_TEXT = '🧭 알겠어요. 다음 주 월요일에 다시 여쭤볼게요.';
const MAX_TITLE_LENGTH = 80;
const MAX_KEYWORDS = 6;

export interface HandleGoalAnswerInput {
  slackUserId: string;
  text: string;
  now: Date;
}

export interface HandleGoalAnswerResult {
  replyText: string;
  previewId?: string;
}

type DraftIntent = 'GOAL' | 'DECLINE' | 'NOT_A_GOAL';

interface DraftResponse {
  intent: DraftIntent;
  goal: ProductGoalDraft | null;
  otherGoalTitles: string[];
}

@Injectable()
export class HandleGoalAnswerUsecase {
  private readonly logger = new Logger(HandleGoalAnswerUsecase.name);

  constructor(
    @Inject(GOAL_QUESTION_REPOSITORY_PORT)
    private readonly questions: GoalQuestionRepositoryPort,
    @Inject(PRODUCT_GOAL_REPOSITORY_PORT)
    private readonly goals: ProductGoalRepositoryPort,
    @Inject(PREVIEW_ACTION_REPOSITORY_PORT)
    private readonly previews: PreviewActionRepositoryPort,
    private readonly createPreview: CreatePreviewUsecase,
    private readonly cancelPreview: CancelPreviewUsecase,
    private readonly modelRouter: ModelRouterUsecase,
  ) {}

  async execute({
    slackUserId,
    text,
    now,
  }: HandleGoalAnswerInput): Promise<HandleGoalAnswerResult | null> {
    const question = await this.questions.findOpen({ slackUserId, now });
    if (question === null) {
      return null;
    }
    if (parseProductGoalCommand(text, todayInKst(now)).kind !== 'NONE') {
      return null;
    }

    const previousPreview =
      question.previewId === null
        ? null
        : await this.previews.findById(question.previewId);
    if (
      question.previewId !== null &&
      (previousPreview === null ||
        previousPreview.status !== PREVIEW_STATUS.PENDING ||
        previousPreview.expiresAt <= now)
    ) {
      await this.questions.close({
        id: question.id,
        reason: 'CARD_RESOLVED',
        at: now,
      });
      return null;
    }

    const priorDraft =
      previousPreview === null
        ? readProductGoalDraft(question.pendingDraft)
        : readPreviewDraft(previousPreview.payload);
    const response = await this.draftResponse({ text, priorDraft });
    if (response === null) {
      return { replyText: RETRY_TEXT };
    }
    if (response.intent === 'NOT_A_GOAL') {
      return null;
    }
    if (response.intent === 'DECLINE') {
      await this.questions.close({
        id: question.id,
        reason: 'DECLINED',
        at: now,
      });
      return { replyText: DECLINE_TEXT };
    }
    if (response.goal === null) {
      return { replyText: RETRY_TEXT };
    }

    let draft = response.goal;
    let convertedToDirection = false;
    // 기준이 비었을 때만 되묻는다. 기준 문장의 품질은 카드를 보고 사람이 판정한다
    // (findGoalDeclarationProblem 의 MISSING_CRITERION 과 같은 기준).
    if (
      draft.kind === 'TASK' &&
      (draft.successCriterion === null || draft.successCriterion.trim() === '')
    ) {
      if (question.criterionAskedAt === null) {
        await this.questions.markCriterionAsked({
          id: question.id,
          at: now,
          pendingDraft: draft,
        });
        return {
          replyText: `🧭 "${escapeSlackMrkdwn(draft.title)}" — 끝난 건 어떻게 알 수 있을까요?`,
        };
      }
      draft = { ...draft, kind: 'DIRECTION' };
      convertedToDirection = true;
    }
    // 방향은 작업 연결을 하지 않는다 — 모델이 채웠거나 숙제에서 바뀐 경우의 키워드를 비운다.
    if (draft.kind === 'DIRECTION') {
      draft = { ...draft, keywords: [] };
    }
    if (draft.kind === 'TASK' && draft.keywords.length === 0) {
      draft = {
        ...draft,
        keywords: extractTitleKeywords(draft.title).slice(0, MAX_KEYWORDS),
      };
    }

    const activeGoals = await this.goals.findActive(slackUserId);
    const problem = findGoalDeclarationProblem({ draft, activeGoals });
    if (problem !== null) {
      if (
        problem === 'ACTIVE_LIMIT_REACHED' ||
        problem === 'DIRECTION_LIMIT_REACHED'
      ) {
        await this.questions.close({
          id: question.id,
          reason: 'LIMIT_REACHED',
          at: now,
        });
      }
      return { replyText: formatGoalProblem(problem, activeGoals) };
    }

    const previewText = formatGoalCreatePreview(draft, {
      conversation: true,
      otherGoalTitles: response.otherGoalTitles,
      directionCriterionHint: convertedToDirection,
    });
    if (previousPreview !== null) {
      await this.cancelPreview.execute({
        previewId: previousPreview.id,
        slackUserId,
      });
    }
    const created = await this.createPreview.execute({
      slackUserId,
      kind: PREVIEW_KIND.PRODUCT_GOAL,
      payload: { action: 'CREATE', draft, origin: 'GOAL_QUESTION' },
      previewText,
      ttlMs: GOAL_PREVIEW_TTL_MS,
    });
    await this.questions.attachPreview({
      id: question.id,
      previewId: created.id,
    });
    return { replyText: previewText, previewId: created.id };
  }

  private async draftResponse({
    text,
    priorDraft,
  }: {
    text: string;
    priorDraft: unknown;
  }): Promise<DraftResponse | null> {
    try {
      const completion = await this.modelRouter.route({
        agentType: AgentType.PO_SHADOW,
        noContractPreamble: true,
        request: {
          systemPrompt: GOAL_DRAFT_SYSTEM_PROMPT,
          prompt: buildGoalDraftPrompt({
            text,
            priorDraft: priorDraft ?? undefined,
          }),
          outputSchema: GOAL_DRAFT_OUTPUT_SCHEMA,
        },
      });
      const parsed = JSON.parse(
        extractJsonObjectText(completion.text),
      ) as unknown;
      return readDraftResponse(parsed);
    } catch (error: unknown) {
      this.logger.warn(
        `목표 초안 모델 호출 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}

const readPreviewDraft = (payload: unknown): ProductGoalDraft | null => {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  return readProductGoalDraft(record.draft);
};

const readDraftResponse = (value: unknown): DraftResponse | null => {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  // 목표 아님·거절이면 나머지 칸은 쓰지 않는다. 모델이 덤으로 채웠다고 재요청하면
  // 엉뚱한 DM 에 "다시 말해 주세요" 가 나간다.
  if (record.intent === 'DECLINE' || record.intent === 'NOT_A_GOAL') {
    return { intent: record.intent, goal: null, otherGoalTitles: [] };
  }
  if (
    !Array.isArray(record.otherGoalTitles) ||
    !record.otherGoalTitles.every(
      (title) => typeof title === 'string' && title.length <= MAX_TITLE_LENGTH,
    )
  ) {
    return null;
  }
  if (record.intent !== 'GOAL') {
    return null;
  }
  if (typeof record.goal !== 'object' || record.goal === null) {
    return null;
  }
  const rawGoal = record.goal as Record<string, unknown>;
  if (
    (rawGoal.kind !== 'DIRECTION' && rawGoal.kind !== 'TASK') ||
    !('why' in rawGoal) ||
    !('successCriterion' in rawGoal) ||
    !('keywords' in rawGoal) ||
    !('dueDate' in rawGoal)
  ) {
    return null;
  }
  if (rawGoal.dueDate !== null && typeof rawGoal.dueDate !== 'string') {
    return null;
  }
  const normalizedGoal = {
    ...rawGoal,
    dueDate:
      typeof rawGoal.dueDate === 'string' && isActualDate(rawGoal.dueDate)
        ? rawGoal.dueDate
        : null,
  };
  const goal = readProductGoalDraft(normalizedGoal);
  if (
    goal === null ||
    goal.title.length > MAX_TITLE_LENGTH ||
    goal.keywords.length > MAX_KEYWORDS
  ) {
    return null;
  }
  return { intent: 'GOAL', goal, otherGoalTitles: record.otherGoalTitles };
};

const isActualDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
};
