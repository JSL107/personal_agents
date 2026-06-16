import { plainDateToIso } from '../../vacation/domain/plain-date';
import {
  ApplicationStatus,
  JobApplicationRecord,
} from '../domain/job-application.type';

// 상태 코드 → 사람이 읽는 한국어 라벨.
const STATUS_LABEL: Record<ApplicationStatus, string> = {
  APPLIED: '지원함',
  SCREENING: '서류심사',
  INTERVIEW: '면접',
  OFFER: '오퍼',
  REJECTED: '불합격',
  WITHDRAWN: '지원취소',
};

const statusLabel = (status: ApplicationStatus): string =>
  STATUS_LABEL[status] ?? status;

// Slack mrkdwn control 문자 escape — 사용자 입력(회사/직무/메모)에 의한 메시지 위조 차단.
// career-mate.formatter 와 동일 패턴 (& < > 만 escape — mrkdwn 링크/멘션 위조 차단에 충분).
const escapeSlackMrkdwn = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 한 건을 목록 줄로 — 회사 · 직무 (상태) [부가정보].
const recordLine = (record: JobApplicationRecord): string => {
  const company = escapeSlackMrkdwn(record.company);
  const role = escapeSlackMrkdwn(record.role);
  const extras: string[] = [];
  if (record.deadline) {
    extras.push(`마감 ${plainDateToIso(record.deadline)}`);
  }
  if (record.nextFollowUpAt) {
    extras.push(`팔로업 ${plainDateToIso(record.nextFollowUpAt)}`);
  }
  const suffix = extras.length > 0 ? ` · ${extras.join(' · ')}` : '';
  return `• *${company}* — ${role} (${statusLabel(record.status)})${suffix}`;
};

export const formatApplicationList = (
  records: JobApplicationRecord[],
): string => {
  if (records.length === 0) {
    return '*📋 지원 현황*\n\n아직 등록된 지원 내역이 없습니다. "토스 백엔드 지원했어" 처럼 알려주세요.';
  }
  const rows = records.map(recordLine);
  return ['*📋 지원 현황*', '', ...rows].join('\n');
};

export const formatAdded = (record: JobApplicationRecord): string => {
  const company = escapeSlackMrkdwn(record.company);
  const role = escapeSlackMrkdwn(record.role);
  const lines = [
    `*✅ 지원 등록 완료*`,
    `• *${company}* — ${role} (${statusLabel(record.status)})`,
    `• 지원일: ${plainDateToIso(record.appliedAt)}`,
    record.deadline ? `• 마감: ${plainDateToIso(record.deadline)}` : null,
  ];
  return lines.filter((line): line is string => line !== null).join('\n');
};

export const formatUpdated = (record: JobApplicationRecord): string => {
  const company = escapeSlackMrkdwn(record.company);
  const role = escapeSlackMrkdwn(record.role);
  return [
    `*🔄 상태 변경 완료*`,
    `• *${company}* — ${role}`,
    `• 현재 상태: ${statusLabel(record.status)}`,
  ].join('\n');
};

export const formatNudge = (records: JobApplicationRecord[]): string => {
  const rows = records.map(recordLine);
  return [
    '마감이 임박했거나 팔로업이 필요한 지원 건이 있어요:',
    '',
    ...rows,
  ].join('\n');
};

export const formatUnknownJobApplication = (): string =>
  [
    '무엇을 도와드릴까요?',
    '• 지원 기록: "토스 백엔드 지원했어"',
    '• 상태 변경: "토스 서류 합격"',
    '• 현황 조회: "지원 현황 보여줘"',
  ].join('\n');
