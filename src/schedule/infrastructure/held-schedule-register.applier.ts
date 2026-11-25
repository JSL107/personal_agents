import { Inject, Injectable } from '@nestjs/common';

import { readPlainDate } from '../../agent/vacation/domain/plain-date';
import {
  isNonEmptyString,
  isPositiveSafeInteger,
  isRecord,
} from '../../common/util/type-guard.util';
import { ApplyResult } from '../../preview-gate/domain/apply-result.type';
import {
  ApplyProgress,
  PreviewApplier,
} from '../../preview-gate/domain/port/preview-applier.port';
import {
  PREVIEW_KIND,
  PreviewAction,
} from '../../preview-gate/domain/preview-action.type';
import { formatScheduleRegistered } from '../../slack/format/schedule.formatter';
import { RegisterScheduleUsecase } from '../application/register-schedule.usecase';
import { plainDateToUtcDate } from '../domain/parse-due-date';
import {
  SCHEDULE_REPOSITORY_PORT,
  ScheduleRepositoryPort,
} from '../domain/port/schedule.repository.port';
import { PlainDate } from '../domain/schedule.type';

interface HeldScheduleRegisterPayload {
  sourceRunId: number;
  title: string;
  dueDate: PlainDate;
}

const SCHEDULE_REGISTERED_STEP = 'schedule-registered:';

const parsePayload = (payload: unknown): HeldScheduleRegisterPayload => {
  if (!isRecord(payload)) {
    throw new Error('HeldScheduleRegisterPayload 형식이 올바르지 않습니다.');
  }
  const candidate = payload;
  if (!isPositiveSafeInteger(candidate.sourceRunId)) {
    throw new Error('HeldScheduleRegisterPayload 필드가 올바르지 않습니다.');
  }
  if (!isNonEmptyString(candidate.title)) {
    throw new Error('HeldScheduleRegisterPayload 필드가 올바르지 않습니다.');
  }
  const dueDate = readPlainDate(candidate.dueDate);
  // plainDateToUtcDate(Date.UTC)는 0~99년을 1900년대로 바꿔 엉뚱한 날짜로 등록한다.
  const isTwoDigitYear = dueDate !== null && dueDate.year < 100;
  if (!dueDate || isTwoDigitYear) {
    throw new Error(
      'HeldScheduleRegisterPayload.dueDate 가 유효한 날짜가 아닙니다.',
    );
  }
  return {
    sourceRunId: candidate.sourceRunId,
    title: candidate.title.trim(),
    dueDate,
  };
};

@Injectable()
export class HeldScheduleRegisterApplier implements PreviewApplier {
  readonly kind = PREVIEW_KIND.HELD_SCHEDULE_REGISTER;
  readonly resumable = true;

  constructor(
    @Inject(SCHEDULE_REPOSITORY_PORT)
    private readonly repository: ScheduleRepositoryPort,
    private readonly registerSchedule: RegisterScheduleUsecase,
  ) {}

  // eslint-disable-next-line no-restricted-syntax -- PreviewApplier 인터페이스가 인자 순서를 정한다.
  async apply(
    preview: PreviewAction,
    progress?: ApplyProgress,
  ): Promise<ApplyResult> {
    const payload = parsePayload(preview.payload);
    const recorded = progress?.done.some((step) =>
      step.startsWith(SCHEDULE_REGISTERED_STEP),
    );
    if (recorded) {
      return { message: '이 일정은 이미 등록돼 있어요.', artifacts: [] };
    }

    const dueDate = plainDateToUtcDate(payload.dueDate);
    const found = await this.repository.findUnfinished({
      slackUserId: preview.slackUserId,
    });
    const duplicate = found.some(
      (item) =>
        item.title === payload.title &&
        item.dueDate?.getTime() === dueDate.getTime(),
    );
    if (duplicate) {
      return { message: '이 일정은 이미 등록돼 있어요.', artifacts: [] };
    }

    const schedule = await this.registerSchedule.execute({
      slackUserId: preview.slackUserId,
      title: payload.title,
      dueDate: payload.dueDate,
    });
    await progress?.record(`${SCHEDULE_REGISTERED_STEP}${schedule.id}`);
    return { message: formatScheduleRegistered(schedule), artifacts: [] };
  }
}
