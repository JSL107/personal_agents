import { PoShadowReport } from '../../agent/po-shadow/domain/po-shadow.type';
import { escapeSlackMrkdwn } from './mrkdwn.util';

// /po-shadow 결과 — PO 시각의 검토를 한국어 Slack 마크다운으로 렌더.
// LLM 자유텍스트 필드는 escapeSlackMrkdwn 으로 제어문자(<>&) escape — Slack 이 `<...>` 를
// 링크 태그로 오인해 텍스트가 잘리는 렌더 위조를 막는다.
export const formatPoShadowReport = (report: PoShadowReport): string => {
  const lines: string[] = [
    '*PO Shadow 검토*',
    '',
    `🎯 *우선순위 재점검*: ${escapeSlackMrkdwn(report.priorityRecheck)}`,
    '',
    `❓ *진짜 목적 재질문*: ${escapeSlackMrkdwn(report.realPurposeQuestion)}`,
    '',
  ];

  if (report.missingRequirements.length > 0) {
    lines.push(
      '*누락 가능 요구사항*',
      ...report.missingRequirements.map((r) => `• ${escapeSlackMrkdwn(r)}`),
      '',
    );
  }

  if (report.releaseRisks.length > 0) {
    lines.push(
      '*release 리스크*',
      ...report.releaseRisks.map((r) => `• ${escapeSlackMrkdwn(r)}`),
      '',
    );
  }

  lines.push('*권고*', escapeSlackMrkdwn(report.recommendation));
  return lines.join('\n');
};
