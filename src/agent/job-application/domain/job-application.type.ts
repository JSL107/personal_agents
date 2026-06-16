import { PlainDate } from '../../vacation/domain/plain-date';

export type ApplicationStatus =
  | 'APPLIED'
  | 'SCREENING'
  | 'INTERVIEW'
  | 'OFFER'
  | 'REJECTED'
  | 'WITHDRAWN';

export const APPLICATION_STATUSES: ApplicationStatus[] = [
  'APPLIED',
  'SCREENING',
  'INTERVIEW',
  'OFFER',
  'REJECTED',
  'WITHDRAWN',
];

// 종료 상태 — UPDATE 매칭/넛지에서 제외한다.
export const TERMINAL_STATUSES: ApplicationStatus[] = [
  'OFFER',
  'REJECTED',
  'WITHDRAWN',
];

export type JobApplicationAction = 'ADD' | 'UPDATE_STATUS' | 'LIST' | 'UNKNOWN';

export interface JobApplicationIntent {
  action: JobApplicationAction;
  company?: string;
  role?: string;
  jdUrl?: string;
  status?: ApplicationStatus;
  deadline?: PlainDate;
  ref?: string; // UPDATE 대상 회사명 매칭용
}

export interface JobApplicationRecord {
  id: number;
  slackUserId: string;
  company: string;
  role: string;
  jdUrl: string | null;
  status: ApplicationStatus;
  appliedAt: PlainDate;
  deadline: PlainDate | null;
  nextFollowUpAt: PlainDate | null;
  notes: string | null;
  createdAt: Date;
}

export interface AddApplicationInput {
  slackUserId: string;
  company: string;
  role: string;
  jdUrl?: string;
  status?: ApplicationStatus; // 기본 APPLIED
  appliedAt: PlainDate; // 기본 today (dispatcher 가 주입)
  deadline?: PlainDate;
}

export interface UpdateApplicationInput {
  slackUserId: string;
  ref: string;
  status: ApplicationStatus;
}

export interface ListApplicationsInput {
  slackUserId: string;
}
