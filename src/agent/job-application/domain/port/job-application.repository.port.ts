import { PlainDate } from '../../../vacation/domain/plain-date';
import {
  ApplicationStatus,
  JobApplicationRecord,
} from '../job-application.type';

export const JOB_APPLICATION_REPOSITORY_PORT = Symbol(
  'JOB_APPLICATION_REPOSITORY_PORT',
);

export interface SaveApplicationInput {
  slackUserId: string;
  company: string;
  role: string;
  jdUrl?: string;
  status: ApplicationStatus;
  appliedAt: PlainDate;
  deadline?: PlainDate;
  nextFollowUpAt?: PlainDate; // 미지정 시 null 저장(usecase 가 정책에 따라 계산해 주입).
}

export interface UpdateStatusByCompanyInput {
  slackUserId: string;
  companyRef: string;
  status: ApplicationStatus;
  nextFollowUpAt: PlainDate | null; // 비종료 전환 시 클럭 리셋, 종료 전환 시 null.
}

export interface FindDueNudgesInput {
  slackUserId: string;
  today: PlainDate;
  deadlineWithinDays: number;
}

export interface JobApplicationRepositoryPort {
  save(input: SaveApplicationInput): Promise<JobApplicationRecord>;
  updateStatusByCompany(
    input: UpdateStatusByCompanyInput,
  ): Promise<JobApplicationRecord | null>;
  listByUser(slackUserId: string): Promise<JobApplicationRecord[]>;
  findDueNudges(input: FindDueNudgesInput): Promise<JobApplicationRecord[]>;
}
