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
}

export interface UpdateStatusByCompanyInput {
  slackUserId: string;
  companyRef: string;
  status: ApplicationStatus;
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
