import { match } from 'ts-pattern';

import { StudyBriefVerdict } from '../domain/study-brief.type';

const SLACK_TEXT_LIMIT = 3000;
const TRUNCATION_SUFFIX = '\n\n_(Slack 길이 제한으로 일부 생략)_';

export interface FormatStudyBriefInput {
  mode?: 'fallback' | 'link';
  notionUrl?: string;
  topic: string;
  verdict: StudyBriefVerdict;
  reportMd: string;
}

export interface FormattedStudyBrief {
  summary: string;
  full: string;
  truncated: boolean;
  summaryFallback: boolean;
}

export const formatStudyBrief = ({
  mode = 'fallback',
  notionUrl,
  topic,
  verdict,
  reportMd,
}: FormatStudyBriefInput): FormattedStudyBrief => {
  const safeTopic = escapeStudyMrkdwn(topic);
  if (mode === 'link' && notionUrl) {
    const extracted = extractThreeLineSummary(reportMd);
    const title =
      verdict.kind === 'CONCEPT'
        ? `📚 *오늘의 공부 — ${safeTopic}*   ·  ${verdict.minutes}분`
        : `🔧 *오늘의 도구 — ${safeTopic}*   ·  설치 ${verdict.minutes}분`;
    const summary = [
      title,
      '',
      escapeStudyMrkdwn(extracted.text),
      '',
      `<${escapeLinkTarget(notionUrl)}|Notion에서 전체 읽기>`,
    ].join('\n');
    return {
      summary,
      full: '',
      truncated: false,
      summaryFallback: extracted.fallback,
    };
  }
  const summary = match(verdict)
    .with({ kind: 'CONCEPT' }, (concept) =>
      [
        `📚 *오늘의 공부 — ${safeTopic}*   ·  ${concept.minutes}분`,
        '',
        `*왜 지금 나한테* ${escapeStudyMrkdwn(concept.whyNow)}`,
        `*어디에 닿나* ${escapeStudyMrkdwn(concept.whereItLands)}`,
      ].join('\n'),
    )
    .with({ kind: 'TOOL' }, (tool) => {
      const lines = [
        `🔧 *오늘의 도구 — ${safeTopic}*   ·  설치 ${tool.minutes}분`,
        '',
        `*뭐가 좋아지나* ${escapeStudyMrkdwn(tool.whatImproves)}`,
        `*붙이는 비용* ${escapeStudyMrkdwn(tool.adoptionCost)}`,
      ];
      if (tool.caution !== undefined) {
        lines.push(`*주의* ${escapeStudyMrkdwn(tool.caution)}`);
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

  return { summary, full, truncated, summaryFallback: false };
};

interface ExtractedSummary {
  text: string;
  fallback: boolean;
}

const extractThreeLineSummary = (reportMd: string): ExtractedSummary => {
  const lines = reportMd.split(/\r?\n/);
  const headingIndex = lines.findIndex(
    (line) => line.trim() === '## 세 줄 요약',
  );
  if (headingIndex >= 0) {
    const sectionLines: string[] = [];
    for (const line of lines.slice(headingIndex + 1)) {
      if (/^##\s+/.test(line.trim())) {
        break;
      }
      if (line.trim().length > 0) {
        sectionLines.push(stripSummaryMarkdown(line.trim()));
      }
    }
    if (sectionLines.length > 0) {
      return { text: sectionLines.slice(0, 3).join('\n'), fallback: false };
    }
  }

  const paragraphLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      if (paragraphLines.length > 0) {
        break;
      }
      continue;
    }
    if (/^#{1,6}\s+/.test(trimmed)) {
      continue;
    }
    paragraphLines.push(stripSummaryMarkdown(trimmed));
    if (paragraphLines.length === 3) {
      break;
    }
  }
  return { text: paragraphLines.join('\n'), fallback: true };
};

const stripSummaryMarkdown = (text: string): string =>
  text
    .replace(/^[-*]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1');

const escapeLinkTarget = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const escapeStudyMrkdwn = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([*_~`])/g, '\\$1');
