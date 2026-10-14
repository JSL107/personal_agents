import { Inject, Injectable } from '@nestjs/common';

import { ApplyResult } from '../../preview-gate/domain/apply-result.type';
import { PreviewApplier } from '../../preview-gate/domain/port/preview-applier.port';
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

  async apply(preview: PreviewAction): Promise<ApplyResult> {
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
    const schedule = await this.registerSchedule.execute({
      slackUserId: preview.slackUserId,
      title: payload.title,
      dueDate,
      memo: payload.memo,
    });
    await this.repository.markScheduled(payload.ideaTriageId, schedule.id);
    return {
      message: `📅 ${formatDate(dueDate)} 「${payload.title}」 일정 등록`,
      artifacts: [],
    };
  }
}
