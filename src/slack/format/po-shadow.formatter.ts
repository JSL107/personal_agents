import { PoShadowReport } from '../../agent/po-shadow/domain/po-shadow.type';
import { escapeSlackMrkdwn } from './mrkdwn.util';

// /po-shadow 결과 — PO 시각의 검토를 한국어 Slack 마크다운으로 렌더.
// LLM 자유텍스트 필드는 escapeSlackMrkdwn 으로 제어문자(<>&) escape — Slack 이 `<...>` 를
// 링크 태그로 오인해 텍스트가 잘리는 렌더 위조를 막는다.
//
// 읽는 순서 = 결정하는 순서다. 결론(recommendation)을 맨 위에 두고 근거를 아래에 깐다.
// 예전에는 권고가 맨 아래였는데, 첫 줄의 우선순위 재점검이 이미 같은 결론을 담고 있어
// 사용자가 같은 말을 두 번 읽고서야 "그래서 뭘 먼저 하라는 건지"에 도달했다.
// 되묻기(realPurposeQuestion)는 실행 항목이 아니라 마지막에 던지는 질문이므로 맨 아래.
export const formatPoShadowReport = (report: PoShadowReport): string => {
  const sections: string[] = ['*PO Shadow 검토*'];

  // 모델이 빈 문자열을 낼 수 있다(프롬프트로 금지하지만 강제되진 않는다). 라벨만 남은
  // 빈 줄을 내보내면 "먼저 이것부터" 뒤에 아무것도 없는 카드가 된다 — 아예 뺀다.
  const recommendation = report.recommendation.trim();
  if (recommendation.length > 0) {
    sections.push(`🎯 *먼저 이것부터* ${escapeSlackMrkdwn(recommendation)}`);
  }

  const priorityRecheck = report.priorityRecheck.trim();
  if (priorityRecheck.length > 0) {
    sections.push(`*순서 점검* ${escapeSlackMrkdwn(priorityRecheck)}`);
  }

  if (report.missingRequirements.length > 0) {
    sections.push(
      ['*빠진 것*', ...toBullets(report.missingRequirements)].join('\n'),
    );
  }

  if (report.releaseRisks.length > 0) {
    sections.push(
      ['*배포 전 위험*', ...toBullets(report.releaseRisks)].join('\n'),
    );
  }

  const realPurposeQuestion = report.realPurposeQuestion.trim();
  if (realPurposeQuestion.length > 0) {
    sections.push(`❓ ${escapeSlackMrkdwn(realPurposeQuestion)}`);
  }

  return sections.join('\n\n');
};

const toBullets = (items: string[]): string[] =>
  items.map((item) => `• ${escapeSlackMrkdwn(item)}`);
