import { Inject, Injectable } from '@nestjs/common';

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
  parsePlainDate,
  PlainDate,
  plainDateToIso,
  todayInKst,
} from '../../vacation/domain/plain-date';
import { AddApplicationUsecase } from '../application/add-application.usecase';
import { UpdateApplicationUsecase } from '../application/update-application.usecase';
import {
  APPLICATION_STATUSES,
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
  if (typeof candidate !== 'object' || candidate === null) {
    throw new Error('지원 날짜 형식이 올바르지 않습니다.');
  }
  const fields = candidate as Record<string, unknown>;
  if (
    !Number.isInteger(fields.year) ||
    !Number.isInteger(fields.month) ||
    !Number.isInteger(fields.day)
  ) {
    throw new Error('지원 날짜 형식이 올바르지 않습니다.');
  }
  const date = {
    year: fields.year as number,
    month: fields.month as number,
    day: fields.day as number,
  };
  const parsed = parsePlainDate(plainDateToIso(date));
  if (!parsed) {
    throw new Error('유효하지 않은 지원 날짜입니다.');
  }
  return parsed;
};

const parseStatus = (candidate: unknown): ApplicationStatus => {
  if (
    typeof candidate !== 'string' ||
    !APPLICATION_STATUSES.includes(candidate as ApplicationStatus)
  ) {
    throw new Error('지원 상태가 올바르지 않습니다.');
  }
  return candidate as ApplicationStatus;
};

const parseJobUrl = (candidate: unknown): string | undefined => {
  if (candidate === undefined) {
    return undefined;
  }
  if (typeof candidate !== 'string' || candidate.trim().length === 0) {
    throw new Error('지원 공고 링크가 올바르지 않습니다.');
  }
  try {
    const url = new URL(candidate);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return candidate;
    }
  } catch {
    throw new Error('지원 공고 링크가 올바르지 않습니다.');
  }
  throw new Error('지원 공고 링크가 올바르지 않습니다.');
};

const parseOptionalDate = (candidate: unknown): PlainDate | undefined => {
  if (candidate === undefined) {
    return undefined;
  }
  return parseDate(candidate);
};

const parsePayload = (payload: unknown): HeldJobPayload => {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('지원 승인 payload 형식이 올바르지 않습니다.');
  }
  const candidate = payload as Record<string, unknown>;
  if (
    !Number.isSafeInteger(candidate.sourceRunId) ||
    (candidate.sourceRunId as number) <= 0
  ) {
    throw new Error('지원 승인 sourceRunId가 올바르지 않습니다.');
  }
  const sourceRunId = candidate.sourceRunId as number;
  if (candidate.action === 'UPDATE_STATUS') {
    if (
      !Number.isSafeInteger(candidate.applicationId) ||
      (candidate.applicationId as number) <= 0
    ) {
      throw new Error('지원 승인 applicationId가 올바르지 않습니다.');
    }
    return {
      sourceRunId,
      action: 'UPDATE_STATUS',
      applicationId: candidate.applicationId as number,
      expectedStatus: parseStatus(candidate.expectedStatus),
      status: parseStatus(candidate.status),
    };
  }
  if (
    candidate.action !== 'ADD' ||
    typeof candidate.company !== 'string' ||
    candidate.company.trim().length === 0 ||
    typeof candidate.role !== 'string' ||
    candidate.role.trim().length === 0
  ) {
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
    const found = await this.repository.listByUser(preview.slackUserId);
    const duplicate = found.some(
      (record) =>
        record.company === payload.company &&
        record.role === payload.role &&
        !TERMINAL_STATUSES.includes(record.status),
    );
    if (duplicate) {
      return {
        message: '같은 회사와 직무의 진행 중 지원이 이미 있어요.',
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
