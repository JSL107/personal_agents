import { plainDateToIso } from '../../agent/vacation/domain/plain-date';
import {
  CancelLeaveResult,
  LeaveUsageRecord,
  RegisterLeaveResult,
  VacationBalance,
} from '../../agent/vacation/domain/vacation.type';

const period = (balance: VacationBalance): string =>
  `${plainDateToIso(balance.periodStart)} ~ ${plainDateToIso(balance.periodEnd)}`;

const balanceLines = (balance: VacationBalance): string[] => {
  const lines = [
    `*현재 회기*: ${period(balance)}`,
    `• 부여: ${balance.grantedDays}일`,
    `• 사용: ${balance.usedDays}일`,
    `• 잔여: ${balance.remainingDays}일`,
  ];
  if (balance.remainingDays < 0) {
    lines.push(
      `⚠️ 부여량을 ${Math.abs(balance.remainingDays)}일 초과 사용했습니다.`,
    );
  }
  return lines;
};

const rangeText = (record: LeaveUsageRecord): string => {
  if (plainDateToIso(record.startDate) === plainDateToIso(record.endDate)) {
    return plainDateToIso(record.startDate);
  }
  return `${plainDateToIso(record.startDate)} ~ ${plainDateToIso(record.endDate)}`;
};

export const formatBalance = (balance: VacationBalance): string => {
  return ['*🏖️ 휴가 잔여*', '', ...balanceLines(balance)].join('\n');
};

export const formatRegistered = ({
  registered,
  balance,
}: RegisterLeaveResult): string => {
  const lines = [
    `*✅ 휴가 등록 완료* (#${registered.id})`,
    `• 기간: ${rangeText(registered)} (${registered.businessDays}영업일)`,
    registered.memo ? `• 메모: ${registered.memo}` : null,
    `• 취소하려면: \`/휴가 취소 ${registered.id}\``,
    '',
    ...balanceLines(balance),
  ];
  return lines.filter((line): line is string => line !== null).join('\n');
};

export const formatUsageList = (records: LeaveUsageRecord[]): string => {
  if (records.length === 0) {
    return '*📋 휴가 내역*\n\n등록된 휴가 내역이 없습니다.';
  }
  const rows = records.map((record) => {
    const memo = record.memo ? ` — ${record.memo}` : '';
    return `• [#${record.id}] ${rangeText(record)} (${record.businessDays}영업일)${memo}`;
  });
  return ['*📋 휴가 내역*', '', ...rows].join('\n');
};

export const formatCanceled = ({
  canceledId,
  balance,
}: CancelLeaveResult): string => {
  return [
    `*🗑️ 휴가 기록 #${canceledId} 취소 완료*`,
    '',
    ...balanceLines(balance),
  ].join('\n');
};

export const formatInvalidCommand = (): string => {
  return [
    '사용법을 확인해주세요:',
    '• `/휴가` 또는 `/휴가 잔여` — 현재 잔여',
    '• `/휴가 사용 2026-07-01~2026-07-03 [메모]` — 사용 등록',
    '• `/휴가 내역` — 사용 내역',
    '• `/휴가 취소 <id>` — 등록 취소',
  ].join('\n');
};
