import { PlainDate } from './plain-date';

export interface LeaveUsageRecord {
  id: number;
  slackUserId: string;
  startDate: PlainDate;
  endDate: PlainDate;
  businessDays: number;
  memo: string | null;
  createdAt: Date;
}

// 잔여 조회 결과 (현재 회기 기준).
export interface VacationBalance {
  hireDate: PlainDate;
  asOf: PlainDate;
  periodStart: PlainDate;
  periodEnd: PlainDate;
  grantedDays: number;
  usedDays: number;
  remainingDays: number;
  usagesInPeriod: LeaveUsageRecord[];
}

export interface RegisterLeaveInput {
  slackUserId: string;
  startDate: PlainDate;
  endDate: PlainDate;
  memo?: string;
}

export interface RegisterLeaveResult {
  registered: LeaveUsageRecord;
  balance: VacationBalance;
}

export interface ListUsageInput {
  slackUserId: string;
}

export interface CancelLeaveInput {
  slackUserId: string;
  usageId: number;
}

export interface CancelLeaveResult {
  canceledId: number;
  balance: VacationBalance;
}
