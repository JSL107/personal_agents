import { Injectable } from '@nestjs/common';

import {
  isPositiveSafeInteger,
  isRecord,
} from '../../../common/util/type-guard.util';
import { ApplyResult } from '../../../preview-gate/domain/apply-result.type';
import {
  ApplyProgress,
  PreviewApplier,
} from '../../../preview-gate/domain/port/preview-applier.port';
import {
  PREVIEW_KIND,
  PreviewAction,
} from '../../../preview-gate/domain/preview-action.type';
import {
  formatCanceled,
  formatRegistered,
} from '../../../slack/format/vacation.formatter';
import { CancelLeaveUsecase } from '../application/cancel-leave.usecase';
import { RegisterLeaveUsecase } from '../application/register-leave.usecase';
import {
  comparePlainDate,
  PlainDate,
  readPlainDate,
  todayInKst,
} from '../domain/plain-date';
import { VacationException } from '../domain/vacation.exception';
import { VacationErrorCode } from '../domain/vacation-error-code.enum';
import { LeaveUsagePrismaRepository } from './leave-usage.prisma.repository';

interface RegisterPayload {
  sourceRunId: number;
  action: 'REGISTER';
  startDate: PlainDate;
  endDate: PlainDate;
  memo?: string;
  fraction?: number;
}

interface CancelPayload {
  sourceRunId: number;
  action: 'CANCEL';
  usageId: number;
}

type HeldVacationPayload = RegisterPayload | CancelPayload;
interface ApplyRegisterInput {
  preview: PreviewAction;
  payload: RegisterPayload;
  progress?: ApplyProgress;
}
interface ApplyCancelInput {
  preview: PreviewAction;
  payload: CancelPayload;
  progress?: ApplyProgress;
}
const WRITTEN_STEP = 'vacation-written:';

const parseDate = (candidate: unknown): PlainDate => {
  const date = readPlainDate(candidate);
  if (!date) {
    throw new Error('유효하지 않은 휴가 날짜입니다.');
  }
  return date;
};

const parsePayload = (payload: unknown): HeldVacationPayload => {
  if (!isRecord(payload)) {
    throw new Error('휴가 승인 payload 형식이 올바르지 않습니다.');
  }
  const candidate = payload;
  if (!isPositiveSafeInteger(candidate.sourceRunId)) {
    throw new Error('휴가 승인 sourceRunId가 올바르지 않습니다.');
  }
  const sourceRunId = candidate.sourceRunId;
  if (candidate.action === 'CANCEL') {
    if (!isPositiveSafeInteger(candidate.usageId)) {
      throw new Error('휴가 승인 usageId가 올바르지 않습니다.');
    }
    return {
      sourceRunId,
      action: 'CANCEL',
      usageId: candidate.usageId,
    };
  }
  if (candidate.action !== 'REGISTER') {
    throw new Error('휴가 승인 action이 올바르지 않습니다.');
  }
  const startDate = parseDate(candidate.startDate);
  const endDate = parseDate(candidate.endDate);
  if (comparePlainDate(startDate, endDate) > 0) {
    throw new Error('휴가 시작일이 종료일보다 늦습니다.');
  }
  if (candidate.memo !== undefined && typeof candidate.memo !== 'string') {
    throw new Error('휴가 메모 형식이 올바르지 않습니다.');
  }
  if (candidate.fraction !== undefined && candidate.fraction !== 0.5) {
    throw new Error('휴가 fraction 값이 올바르지 않습니다.');
  }
  return {
    sourceRunId,
    action: 'REGISTER',
    startDate,
    endDate,
    memo: candidate.memo,
    fraction: candidate.fraction,
  };
};

@Injectable()
export class HeldVacationWriteApplier implements PreviewApplier {
  readonly kind = PREVIEW_KIND.HELD_VACATION_WRITE;
  readonly resumable = true;

  constructor(
    private readonly repository: LeaveUsagePrismaRepository,
    private readonly registerLeave: RegisterLeaveUsecase,
    private readonly cancelLeave: CancelLeaveUsecase,
  ) {}

  // eslint-disable-next-line no-restricted-syntax -- PreviewApplier 인터페이스가 인자 순서를 정한다.
  async apply(
    preview: PreviewAction,
    progress?: ApplyProgress,
  ): Promise<ApplyResult> {
    const payload = parsePayload(preview.payload);
    const recorded = progress?.done.some((step) =>
      step.startsWith(WRITTEN_STEP),
    );
    if (recorded) {
      return { message: '이 휴가 변경은 이미 적용됐어요.', artifacts: [] };
    }
    if (payload.action === 'CANCEL') {
      return this.cancel({ preview, payload, progress });
    }
    return this.register({ preview, payload, progress });
  }

  private async register({
    preview,
    payload,
    progress,
  }: ApplyRegisterInput): Promise<ApplyResult> {
    // 카드 두 장을 차례로 누른 중복을 막는다. 사용 기록에 반차 여부가 없어 기간만 본다 — 같은 기간의
    // 종일·반차를 따로 다시 돌리는 일은 드물고, 그때는 아래 안내로 이미 있는 기록을 알린다.
    const found = await this.repository.findActiveByUser(preview.slackUserId);
    const duplicate = found.some(
      (usage) =>
        comparePlainDate(usage.startDate, payload.startDate) === 0 &&
        comparePlainDate(usage.endDate, payload.endDate) === 0,
    );
    if (duplicate) {
      return {
        message: '같은 기간의 휴가가 이미 등록돼 있어요.',
        artifacts: [],
      };
    }
    const result = await this.registerLeave.execute({
      slackUserId: preview.slackUserId,
      startDate: payload.startDate,
      endDate: payload.endDate,
      memo: payload.memo,
      fraction: payload.fraction,
      asOf: todayInKst(new Date()),
    });
    await progress?.record(`${WRITTEN_STEP}${result.result.registered.id}`);
    return { message: formatRegistered(result.result), artifacts: [] };
  }

  private async cancel({
    preview,
    payload,
    progress,
  }: ApplyCancelInput): Promise<ApplyResult> {
    try {
      const result = await this.cancelLeave.execute({
        slackUserId: preview.slackUserId,
        usageId: payload.usageId,
        asOf: todayInKst(new Date()),
      });
      await progress?.record(`${WRITTEN_STEP}${payload.usageId}`);
      return { message: formatCanceled(result.result), artifacts: [] };
    } catch (error) {
      if (
        error instanceof VacationException &&
        error.errorCode === VacationErrorCode.USAGE_NOT_FOUND
      ) {
        return {
          message: '이 휴가는 이미 취소됐거나 찾을 수 없어요.',
          artifacts: [],
        };
      }
      throw error;
    }
  }
}
