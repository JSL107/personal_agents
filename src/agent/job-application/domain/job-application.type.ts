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

// 팔로업 윈도우 — 지원 등록/상태 변경 시 다음 팔로업 넛지까지의 일수.
// 마감일 없는 진행 중 지원도 이 주기로 넛지가 동작하게 만든다(없으면 영영 넛지 안 됨).
export const FOLLOW_UP_AFTER_DAYS = 7;

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
  today: PlainDate; // dispatcher 가 주입 — 비종료 전환 시 팔로업 클럭 리셋 기준.
}

export interface ListApplicationsInput {
  slackUserId: string;
}
