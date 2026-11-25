import { Inject, Injectable } from '@nestjs/common';

import {
  isNonEmptyString,
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
  comparePlainDate,
  PlainDate,
  readPlainDate,
  todayInKst,
} from '../../vacation/domain/plain-date';
import { AddApplicationUsecase } from '../application/add-application.usecase';
import { UpdateApplicationUsecase } from '../application/update-application.usecase';
import { isApplicationStatus, isWebUrl } from '../domain/job-application.guard';
import {
  ApplicationStatus,
  TERMINAL_STATUSES,
} from '../domain/job-application.type';
import {
  JOB_APPLICATION_REPOSITORY_PORT,
  JobApplicationRepositoryPort,
} from '../domain/port/job-application.repository.port';
import { formatAdded, formatUpdated } from './job-application.formatter';

interface AddPayload {
  sourceRunId: number;
  action: 'ADD';
  company: string;
  role: string;
  jdUrl?: string;
  status: ApplicationStatus;
  deadline?: PlainDate;
  appliedAt: PlainDate;
}

interface UpdatePayload {
  sourceRunId: number;
  action: 'UPDATE_STATUS';
  applicationId: number;
  expectedStatus: ApplicationStatus;
  status: ApplicationStatus;
}

type HeldJobPayload = AddPayload | UpdatePayload;
interface ApplyAddInput {
  preview: PreviewAction;
  payload: AddPayload;
  progress?: ApplyProgress;
}
interface ApplyUpdateInput {
  preview: PreviewAction;
  payload: UpdatePayload;
  progress?: ApplyProgress;
}
const WRITTEN_STEP = 'job-application-written:';

const parseDate = (candidate: unknown): PlainDate => {
  const date = readPlainDate(candidate);
  if (!date) {
    throw new Error('유효하지 않은 지원 날짜입니다.');
  }
  return date;
};

const parseStatus = (candidate: unknown): ApplicationStatus => {
  if (!isApplicationStatus(candidate)) {
    throw new Error('지원 상태가 올바르지 않습니다.');
  }
  return candidate;
};

const parseJobUrl = (candidate: unknown): string | undefined => {
  if (candidate === undefined) {
    return undefined;
  }
  if (!isWebUrl(candidate)) {
    throw new Error('지원 공고 링크가 올바르지 않습니다.');
  }
  return candidate;
};

const parseOptionalDate = (candidate: unknown): PlainDate | undefined => {
  if (candidate === undefined) {
    return undefined;
  }
  return parseDate(candidate);
};

const parsePayload = (payload: unknown): HeldJobPayload => {
  if (!isRecord(payload)) {
    throw new Error('지원 승인 payload 형식이 올바르지 않습니다.');
  }
  const candidate = payload;
  if (!isPositiveSafeInteger(candidate.sourceRunId)) {
    throw new Error('지원 승인 sourceRunId가 올바르지 않습니다.');
  }
  const sourceRunId = candidate.sourceRunId;
  if (candidate.action === 'UPDATE_STATUS') {
    if (!isPositiveSafeInteger(candidate.applicationId)) {
      throw new Error('지원 승인 applicationId가 올바르지 않습니다.');
    }
    return {
      sourceRunId,
      action: 'UPDATE_STATUS',
      applicationId: candidate.applicationId,
      expectedStatus: parseStatus(candidate.expectedStatus),
      status: parseStatus(candidate.status),
    };
  }
  if (candidate.action !== 'ADD') {
    throw new Error('지원 승인 필드가 올바르지 않습니다.');
  }
  if (!isNonEmptyString(candidate.company)) {
    throw new Error('지원 승인 필드가 올바르지 않습니다.');
  }
  if (!isNonEmptyString(candidate.role)) {
    throw new Error('지원 승인 필드가 올바르지 않습니다.');
  }
  const jdUrl = parseJobUrl(candidate.jdUrl);
  const deadline = parseOptionalDate(candidate.deadline);
  return {
    sourceRunId,
    action: 'ADD',
    company: candidate.company.trim(),
    role: candidate.role.trim(),
    jdUrl,
    status: parseStatus(candidate.status),
    appliedAt: parseDate(candidate.appliedAt),
    deadline,
  };
};

@Injectable()
export class HeldJobApplicationWriteApplier implements PreviewApplier {
  readonly kind = PREVIEW_KIND.HELD_JOB_APPLICATION_WRITE;
  readonly resumable = true;

  constructor(
    @Inject(JOB_APPLICATION_REPOSITORY_PORT)
    private readonly repository: JobApplicationRepositoryPort,
    private readonly addApplication: AddApplicationUsecase,
    private readonly updateApplication: UpdateApplicationUsecase,
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
      return { message: '이 지원 변경은 이미 적용됐어요.', artifacts: [] };
    }
    if (payload.action === 'UPDATE_STATUS') {
      return this.update({ preview, payload, progress });
    }
    return this.add({ preview, payload, progress });
  }

  private async add({
    preview,
    payload,
    progress,
  }: ApplyAddInput): Promise<ApplyResult> {
    // 진행 중인 같은 지원, 또는 같은 날 넣은 같은 지원(종료 상태로 추가한 카드 두 장을 차례로 눌러도
    // 두 번째가 막히게 — 상태와 무관하게 지원일로 본다)이 있으면 추가하지 않는다.
    const found = await this.repository.listByUser(preview.slackUserId);
    const duplicate = found.some(
      (record) =>
        record.company === payload.company &&
        record.role === payload.role &&
        (!TERMINAL_STATUSES.includes(record.status) ||
          comparePlainDate(record.appliedAt, payload.appliedAt) === 0),
    );
    if (duplicate) {
      return {
        message: '같은 회사와 직무의 지원이 이미 있어요.',
        artifacts: [],
      };
    }
    const outcome = await this.addApplication.execute({
      slackUserId: preview.slackUserId,
      company: payload.company,
      role: payload.role,
      jdUrl: payload.jdUrl,
      status: payload.status,
      appliedAt: payload.appliedAt,
      deadline: payload.deadline,
    });
    await progress?.record(`${WRITTEN_STEP}${outcome.result.id}`);
    return { message: formatAdded(outcome.result), artifacts: [] };
  }

  private async update({
    preview,
    payload,
    progress,
  }: ApplyUpdateInput): Promise<ApplyResult> {
    const outcome = await this.updateApplication.executeById({
      slackUserId: preview.slackUserId,
      id: payload.applicationId,
      expectedStatus: payload.expectedStatus,
      status: payload.status,
      today: todayInKst(new Date()),
    });
    if (!outcome.result) {
      return {
        message: '카드를 띄운 뒤 그 지원 건이 바뀌었어요. 다시 말해 주세요.',
        artifacts: [],
      };
    }
    await progress?.record(`${WRITTEN_STEP}${outcome.result.id}`);
    return { message: formatUpdated(outcome.result), artifacts: [] };
  }
}
