import { match } from 'ts-pattern';

import { StudyTopicVerdict } from '../../agent/cto/domain/cto.type';

const SLACK_TEXT_LIMIT = 3000;
const TRUNCATION_SUFFIX = '\n\n_(Slack 길이 제한으로 일부 생략)_';

export interface FormatStudyBriefInput {
  topic: string;
  verdict: StudyTopicVerdict;
  reportMd: string;
}

export interface FormattedStudyBrief {
  summary: string;
  full: string;
  truncated: boolean;
}

export const formatStudyBrief = ({
  topic,
  verdict,
  reportMd,
}: FormatStudyBriefInput): FormattedStudyBrief => {
  const safeTopic = escapeStudyMrkdwn(topic);
  const summary = match(verdict)
    .with({ kind: 'CONCEPT' }, (concept) =>
      [
        `📚 *오늘의 공부 — ${safeTopic}*   ·  ${concept.minutes}분`,
        '',
        `이 주제는 ${escapeStudyMrkdwn(concept.whereItLands)}에 닿는다. ${escapeStudyMrkdwn(concept.whyNow)}`,
        '',
        `*왜 지금 나한테*  ${escapeStudyMrkdwn(concept.whyNow)}`,
        `*어디에 닿나*      ${escapeStudyMrkdwn(concept.whereItLands)}`,
        `*읽을 것*          ${escapeStudyMrkdwn(concept.readingPlan)}`,
      ].join('\n'),
    )
    .with({ kind: 'TOOL' }, (tool) => {
      const lines = [
        `🔧 *오늘의 도구 — ${safeTopic}*   ·  설치 ${tool.minutes}분`,
        '',
        `*뭐가 좋아지나*  ${escapeStudyMrkdwn(tool.whatImproves)}`,
        `*붙이는 비용*    ${escapeStudyMrkdwn(tool.adoptionCost)}`,
        `*설치*           ${escapeStudyMrkdwn(tool.installHint)}`,
      ];
      if (tool.caution !== undefined) {
        lines.push(`*주의*           ${escapeStudyMrkdwn(tool.caution)}`);
      }
      return lines.join('\n');
    })
    .exhaustive();
  const escapedReport = escapeStudyMrkdwn(reportMd);
  const truncated = escapedReport.length > SLACK_TEXT_LIMIT;
  const full = truncated
    ? escapedReport.slice(0, SLACK_TEXT_LIMIT - TRUNCATION_SUFFIX.length) +
      TRUNCATION_SUFFIX
    : escapedReport;

  return { summary, full, truncated };
};

const escapeStudyMrkdwn = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([*_~`])/g, '\\$1');
