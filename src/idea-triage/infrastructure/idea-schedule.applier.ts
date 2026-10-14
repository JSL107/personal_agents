import { Inject, Injectable } from '@nestjs/common';

import { ApplyResult } from '../../preview-gate/domain/apply-result.type';
import {
  ApplyProgress,
  PreviewApplier,
} from '../../preview-gate/domain/port/preview-applier.port';
import {
  PREVIEW_KIND,
  PreviewAction,
} from '../../preview-gate/domain/preview-action.type';
import { RegisterScheduleUsecase } from '../../schedule/application/register-schedule.usecase';
import {
  plainDateToUtcDate,
  todayInKst,
} from '../../schedule/domain/parse-due-date';
import { PlainDate } from '../../schedule/domain/schedule.type';
import {
  IDEA_TRIAGE_REPOSITORY_PORT,
  IdeaTriageRepositoryPort,
} from '../domain/port/idea-triage.repository.port';

export interface IdeaSchedulePayload {
  ideaTriageId: number;
  title: string;
  dueDate: PlainDate;
  memo: string;
}

const parsePayload = (payload: unknown): IdeaSchedulePayload => {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('IdeaSchedulePayload 형식이 올바르지 않습니다.');
  }
  const candidate = payload as Record<string, unknown>;
  const date = candidate.dueDate;
  if (typeof date !== 'object' || date === null) {
    throw new Error('IdeaSchedulePayload.dueDate 형식이 올바르지 않습니다.');
  }
  const dateFields = date as Record<string, unknown>;
  const dueDate: PlainDate = {
    year: dateFields.year as number,
    month: dateFields.month as number,
    day: dateFields.day as number,
  };
  if (
    !Number.isInteger(candidate.ideaTriageId) ||
    (candidate.ideaTriageId as number) <= 0 ||
    typeof candidate.title !== 'string' ||
    candidate.title.trim().length === 0 ||
    candidate.title.trim().length > 40 ||
    typeof candidate.memo !== 'string' ||
    !Number.isInteger(dueDate.year) ||
    !Number.isInteger(dueDate.month) ||
    !Number.isInteger(dueDate.day)
  ) {
    throw new Error('IdeaSchedulePayload 필드가 올바르지 않습니다.');
  }
  const normalized = plainDateToUtcDate(dueDate);
  if (
    normalized.getUTCFullYear() !== dueDate.year ||
    normalized.getUTCMonth() + 1 !== dueDate.month ||
    normalized.getUTCDate() !== dueDate.day
  ) {
    throw new Error('IdeaSchedulePayload.dueDate 가 유효한 날짜가 아닙니다.');
  }
  return {
    ideaTriageId: candidate.ideaTriageId as number,
    title: candidate.title.trim(),
    dueDate,
    memo: candidate.memo,
  };
};

// 일정 등록을 마친 단계 이름. 뒤에 붙는 숫자는 만든 ScheduleItem id 다.
const SCHEDULE_REGISTERED_STEP = 'schedule-registered:';

const findRegisteredScheduleId = (
  progress: ApplyProgress | undefined,
): number | null => {
  const step = progress?.done.find((done) =>
    done.startsWith(SCHEDULE_REGISTERED_STEP),
  );
  if (!step) {
    return null;
  }
  const scheduleItemId = Number(step.slice(SCHEDULE_REGISTERED_STEP.length));
  return Number.isInteger(scheduleItemId) && scheduleItemId > 0
    ? scheduleItemId
    : null;
};

const formatDate = (date: PlainDate): string =>
  `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;

@Injectable()
export class IdeaScheduleApplier implements PreviewApplier {
  readonly kind = PREVIEW_KIND.IDEA_SCHEDULE;

  constructor(
    @Inject(IDEA_TRIAGE_REPOSITORY_PORT)
    private readonly repository: IdeaTriageRepositoryPort,
    private readonly registerSchedule: RegisterScheduleUsecase,
  ) {}

  async apply(
    preview: PreviewAction,
    progress?: ApplyProgress,
  ): Promise<ApplyResult> {
    const payload = parsePayload(preview.payload);
    const idea = await this.repository.findById(payload.ideaTriageId);
    if (!idea) {
      throw new Error('아이디어 판정 기록을 찾을 수 없습니다.');
    }
    if (idea.scheduleItemId !== null) {
      return {
        message: `📅 ${formatDate(idea.proposedDate)} 「${payload.title}」 일정 등록`,
        artifacts: [],
      };
    }

    const today = todayInKst(new Date());
    // 승인 지연으로 제안일이 지난 경우 과거 일정이 생기지 않도록 오늘로 당긴다.
    const dueDate =
      plainDateToUtcDate(payload.dueDate).getTime() <
      plainDateToUtcDate(today).getTime()
        ? today
        : payload.dueDate;
    // 일정을 만든 뒤 판정 기록 갱신이 실패하면 카드는 PENDING 으로 돌아와 다시 눌린다. 그때
    // 일정을 또 만들지 않도록 만든 id 를 게이트의 단계 기록에 먼저 남긴다 — 이 기록은 실패한
    // 승인 뒤에도 지워지지 않고 다음 승인의 `progress.done` 으로 돌아온다(`apply-preview.usecase.ts`).
    let scheduleItemId = findRegisteredScheduleId(progress);
    if (scheduleItemId === null) {
      const schedule = await this.registerSchedule.execute({
        slackUserId: preview.slackUserId,
        title: payload.title,
        dueDate,
        memo: payload.memo,
      });
      scheduleItemId = schedule.id;
      await progress?.record(`${SCHEDULE_REGISTERED_STEP}${scheduleItemId}`);
    }
    await this.repository.markScheduled(payload.ideaTriageId, scheduleItemId);
    return {
      message: `📅 ${formatDate(dueDate)} 「${payload.title}」 일정 등록`,
      artifacts: [],
    };
  }
}
