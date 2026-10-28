import { Inject, Injectable, Logger } from '@nestjs/common';
import { isMatching, P } from 'ts-pattern';

import { extractJsonObjectText } from '../../../common/util/llm-json-extract.util';
import { detectYesNoIntent } from '../../../common/util/yes-no-intent.util';
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
  PreviewAction,
} from '../../../preview-gate/domain/preview-action.type';
import { todayInKst } from '../../../schedule/domain/parse-due-date';
import { escapeSlackMrkdwn } from '../../../slack/format/mrkdwn.util';
import {
  formatGoalCreatePreview,
  formatGoalProblem,
} from '../../../slack/format/product-goal.formatter';
import {
  GOAL_QUESTION_REPOSITORY_PORT,
  GoalQuestionCloseReason,
  GoalQuestionRecord,
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
  isBlank,
  parseProductGoalCommand,
  PRODUCT_GOAL_KINDS,
  ProductGoalDraft,
  readProductGoalDraft,
  toPlainDateString,
} from '../domain/product-goal';
import {
  buildGoalDraftPrompt,
  GOAL_DRAFT_OUTPUT_SCHEMA,
  GOAL_DRAFT_SYSTEM_PROMPT,
  GoalDraftIntent,
} from '../domain/prompt/goal-draft.prompt';

const RETRY_TEXT = '🧭 지금 정리가 잘 안 됐어요. 한 번만 다시 말해 주시겠어요?';
const DECLINE_TEXT = '🧭 알겠어요. 다음 주 월요일에 다시 여쭤볼게요.';
const TELL_ME_TEXT = '🧭 좋아요. 어떤 목표인지 한 줄로 말해 주세요.';
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

interface DraftResponse {
  intent: GoalDraftIntent;
  goal: ProductGoalDraft | null;
  otherGoalTitles: string[];
}

// 열린 질문 하나의 현재 상태.
// - card: 질문이 만든 PENDING 카드. 없으면 null(아직 카드 전이거나, 승인 뒤 남은 목표를 이어 받는 중).
// - finished: 카드가 처리됐고 이어 받을 목표도 없다 — 다음 DM 에서 질문을 닫는다.
interface QuestionState {
  question: GoalQuestionRecord;
  card: PreviewAction | null;
  finished: boolean;
}

export interface OpenQuestionCard {
  card: PreviewAction | null;
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

  // 라우터의 자연어 Y/N 인터셉터가 읽는다. 진행 중인 질문이 있으면 Y/N 은 그 질문의 카드에만 적용한다 —
  // 질문에 "응" 으로 답했는데 그 사이 쌓인 다른 카드(목표 [닫기]·아이디어 카드 등)가 승인되거나, 반대로
  // 더 최근 카드 때문에 질문 카드의 승인이 막히면 안 된다. card 가 null 이면 Y/N 을 적용하지 않는다.
  // 진행 중인 질문이 없으면 undefined — 평소처럼 가장 최근 카드에 적용한다.
  async findOpenQuestionCard({
    slackUserId,
    now,
  }: {
    slackUserId: string;
    now: Date;
  }): Promise<OpenQuestionCard | undefined> {
    const state = await this.loadQuestionState({ slackUserId, now });
    if (state === null || state.finished) {
      return undefined;
    }
    return { card: state.card };
  }

  async execute({
    slackUserId,
    text,
    now,
  }: HandleGoalAnswerInput): Promise<HandleGoalAnswerResult | null> {
    const state = await this.loadQuestionState({ slackUserId, now });
    if (state === null) {
      return null;
    }
    if (parseProductGoalCommand(text, todayInKst(now)).kind !== 'NONE') {
      return null;
    }
    const { question, card: previousPreview } = state;
    if (state.finished) {
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
    // "목표 있어요?" 에 "응"/"없어" 만 답한 경우. 모델을 부르지 않고 바로 받는다.
    if (priorDraft === null) {
      const intent = detectYesNoIntent(text);
      if (intent === 'yes') {
        return { replyText: TELL_ME_TEXT };
      }
      if (intent === 'no') {
        await this.closeQuestion({ state, reason: 'DECLINED', now });
        return { replyText: DECLINE_TEXT };
      }
    }
    const response = await this.draftResponse({
      text,
      priorDraft,
      today: toPlainDateString(todayInKst(now)),
    });
    if (response === null) {
      // 이미 목표 흐름에 들어온 대화(되묻기·카드 수정)만 다시 말해 달라고 한다. 첫 답에서 모델이
      // 실패하면 라우터로 넘긴다 — 72시간 동안 평범한 DM 이 "다시 말해 주세요" 에 막히지 않게.
      if (priorDraft === null) {
        return null;
      }
      return { replyText: RETRY_TEXT };
    }
    if (response.intent === 'NOT_A_GOAL') {
      return null;
    }
    if (response.intent === 'DECLINE') {
      await this.closeQuestion({ state, reason: 'DECLINED', now });
      return { replyText: DECLINE_TEXT };
    }
    if (response.goal === null) {
      return { replyText: RETRY_TEXT };
    }

    let draft = response.goal;
    // 모델이 연도를 잘못 짚어 과거 기한을 내면 다음 점검에서 곧바로 "기한 지남" 이 된다. 버리고 기한 없음으로 둔다.
    if (
      draft.dueDate !== null &&
      draft.dueDate < toPlainDateString(todayInKst(now))
    ) {
      draft = { ...draft, dueDate: null };
    }
    let convertedToDirection = false;
    // 기준이 비었을 때만 되묻는다. 기준 문장의 품질은 카드를 보고 사람이 판정한다
    // (findGoalDeclarationProblem 의 MISSING_CRITERION 과 같은 기준).
    if (draft.kind === 'TASK' && isBlank(draft.successCriterion)) {
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
        await this.closeQuestion({ state, reason: 'LIMIT_REACHED', now });
      }
      return { replyText: formatGoalProblem(problem, activeGoals) };
    }

    const previewText = formatGoalCreatePreview(draft, {
      conversation: true,
      otherGoalTitles: response.otherGoalTitles,
      directionCriterionHint: convertedToDirection,
    });
    // 새 카드를 만들고 질문에 붙인 뒤에야 이전 카드를 취소한다. 순서를 뒤집으면 새 카드 생성이
    // 실패했을 때 승인할 카드가 하나도 남지 않고, 질문은 취소된 카드를 가리켜 다음 DM 에서 닫힌다.
    const created = await this.createPreview.execute({
      slackUserId,
      kind: PREVIEW_KIND.PRODUCT_GOAL,
      payload: {
        action: 'CREATE',
        draft,
        origin: 'GOAL_QUESTION',
        otherGoalTitles: response.otherGoalTitles,
      },
      previewText,
      ttlMs: GOAL_PREVIEW_TTL_MS,
    });
    await this.questions.attachPreview({
      id: question.id,
      previewId: created.id,
    });
    if (previousPreview !== null) {
      await this.cancelQuietly(previousPreview, slackUserId);
    }
    return { replyText: previewText, previewId: created.id };
  }

  private async loadQuestionState({
    slackUserId,
    now,
  }: {
    slackUserId: string;
    now: Date;
  }): Promise<QuestionState | null> {
    const question = await this.questions.findOpen({ slackUserId, now });
    if (question === null) {
      return null;
    }
    if (question.previewId === null) {
      return { question, card: null, finished: false };
    }
    const preview = await this.previews.findById(question.previewId);
    if (
      preview !== null &&
      preview.status === PREVIEW_STATUS.PENDING &&
      preview.expiresAt > now
    ) {
      return { question, card: preview, finished: false };
    }
    // 승인된 카드에 함께 말한 목표가 남아 있으면 질문을 이어 간다 — 카드가 "승인 뒤 다시 말해 주세요"
    // 라고 안내하므로, 다음 답을 다시 초안으로 받아야 한다.
    const continuing =
      preview !== null &&
      preview.status === PREVIEW_STATUS.APPLIED &&
      readOtherGoalTitles(preview.payload).length > 0;
    return { question, card: null, finished: !continuing };
  }

  // 질문을 닫을 때 그 질문의 대기 카드도 취소한다. 남겨 두면 다른 대화의 "응" 이 거절한 목표를 저장한다.
  private async closeQuestion({
    state,
    reason,
    now,
  }: {
    state: QuestionState;
    reason: GoalQuestionCloseReason;
    now: Date;
  }): Promise<void> {
    await this.questions.close({ id: state.question.id, reason, at: now });
    if (state.card !== null) {
      await this.cancelQuietly(state.card, state.question.slackUserId);
    }
  }

  // 이전 카드 취소는 정리 단계라 실패해도 답을 막지 않는다 — 남은 카드는 TTL 로 만료된다.
  private async cancelQuietly(
    preview: PreviewAction,
    slackUserId: string,
  ): Promise<void> {
    try {
      await this.cancelPreview.execute({ previewId: preview.id, slackUserId });
    } catch (error: unknown) {
      this.logger.warn(
        `목표 카드 취소 실패 — preview=${preview.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async draftResponse({
    text,
    priorDraft,
    today,
  }: {
    text: string;
    priorDraft: unknown;
    today: string;
  }): Promise<DraftResponse | null> {
    try {
      const completion = await this.modelRouter.route({
        agentType: AgentType.PO_SHADOW,
        noContractPreamble: true,
        request: {
          systemPrompt: GOAL_DRAFT_SYSTEM_PROMPT,
          prompt: buildGoalDraftPrompt({
            text,
            today,
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

const readOtherGoalTitles = (payload: unknown): string[] => {
  if (typeof payload !== 'object' || payload === null) {
    return [];
  }
  const titles = (payload as Record<string, unknown>).otherGoalTitles;
  return Array.isArray(titles)
    ? titles.filter((title): title is string => typeof title === 'string')
    : [];
};

const readPreviewDraft = (payload: unknown): ProductGoalDraft | null => {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  return readProductGoalDraft(record.draft);
};

// 모델 답의 형태. outputSchema 를 걸었어도 코드가 다시 건다 — 형태가 어긋난 답을 카드로 만들지 않는다.
const NON_GOAL_ANSWER = { intent: P.union('DECLINE', 'NOT_A_GOAL') } as const;
const GOAL_ANSWER = {
  intent: 'GOAL',
  goal: {
    kind: P.union(...PRODUCT_GOAL_KINDS),
    title: P.string.maxLength(MAX_TITLE_LENGTH),
    why: P.union(P.string, null),
    successCriterion: P.union(P.string, null),
    keywords: P.array(P.string),
    dueDate: P.union(P.string, null),
  },
  otherGoalTitles: P.array(P.string.maxLength(MAX_TITLE_LENGTH)),
} as const;

const readDraftResponse = (value: unknown): DraftResponse | null => {
  // 목표 아님·거절이면 나머지 칸은 쓰지 않는다. 모델이 덤으로 채웠다고 재요청하면
  // 엉뚱한 DM 에 "다시 말해 주세요" 가 나간다.
  if (isMatching(NON_GOAL_ANSWER, value)) {
    return { intent: value.intent, goal: null, otherGoalTitles: [] };
  }
  if (
    !isMatching(GOAL_ANSWER, value) ||
    value.goal.keywords.length > MAX_KEYWORDS
  ) {
    return null;
  }
  const { goal, otherGoalTitles } = value;
  // 달력에 없는 날짜(2026-02-30 등)는 기한 없음으로 둔다.
  const dueDate =
    goal.dueDate !== null && isActualDate(goal.dueDate) ? goal.dueDate : null;
  return {
    intent: 'GOAL',
    goal: { ...goal, dueDate },
    otherGoalTitles,
  };
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
