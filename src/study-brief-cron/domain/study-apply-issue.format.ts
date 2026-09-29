import { escapeSlackMrkdwn } from '../../slack/format/mrkdwn.util';
import { ApplicabilityJudgement } from './study-applicability.type';

export const ISSUE_TITLE_MAX = 200;
export const ISSUE_BODY_MAX = 8_000;
const FIELD_MAX = 2_000;
// 멘션을 끊는 폭 없는 공백. 소스에서 눈에 보이도록 escape 로 적는다.
const ZERO_WIDTH_SPACE = '​';

export const neutralizeForGithub = (text: string, maxLength: number): string =>
  text
    .replace(/!\[([^\]]*)\]\(([^)\s]*)\)/g, '$1 (`$2`)')
    .replace(/\[([^\]]*)\]\(([^)\s]*)\)/g, '$1 (`$2`)')
    .replace(/(?<!`)\bhttps?:\/\/[^\s)`]+/g, (url) => `\`${url}\``)
    .replace(/@/g, `@${ZERO_WIDTH_SPACE}`)
    .slice(0, maxLength);

export const buildStudyApplyIssue = ({
  topic,
  notionUrl,
  judgement,
}: {
  topic: string;
  notionUrl: string | null;
  judgement: ApplicabilityJudgement;
}): { title: string; body: string } => {
  const proposal = judgement.proposal;
  const rawTitle = proposal?.title ?? topic;
  const title =
    `[오늘의 공부] ${neutralizeForGithub(rawTitle, ISSUE_TITLE_MAX)}`.slice(
      0,
      ISSUE_TITLE_MAX,
    );
  const field = (text: string): string => neutralizeForGithub(text, FIELD_MAX);
  const body = [
    '## 문제',
    field(proposal?.problem ?? ''),
    '',
    '## 바꿀 곳',
    field(proposal?.change ?? ''),
    '',
    '## 검증',
    field(proposal?.verify ?? ''),
    '',
    '## 근거 (코드 위치)',
    ...judgement.citations.map(
      (citation) =>
        `- \`${citation.filePath}:${citation.startLine}-${citation.endLine}\` ${citation.name} — ${field(citation.why)}`,
    ),
    '',
    '## 출처',
    `오늘의 공부: ${field(topic)}${notionUrl ? ` — ${notionUrl}` : ''}`,
    '',
    '_이대리 적용 판정이 제안하고 사람이 승인해 만든 issue 입니다. 구현 전에 근거 위치를 직접 확인하세요._',
  ].join('\n');
  return { title, body: body.slice(0, ISSUE_BODY_MAX) };
};

export const buildStudyApplyPreviewText = ({
  topic,
  judgement,
  repo,
}: {
  topic: string;
  judgement: ApplicabilityJudgement;
  repo: string;
}): string => {
  const escape = (text: string): string =>
    escapeSlackMrkdwn(text.slice(0, FIELD_MAX));
  const proposal = judgement.proposal;
  return [
    `🧭 *오늘의 공부 적용 제안* — ${escape(topic)}`,
    '',
    `*${escape(proposal?.title ?? '')}*`,
    `• 문제: ${escape(proposal?.problem ?? '')}`,
    `• 바꿀 곳: ${escape(proposal?.change ?? '')}`,
    `• 검증: ${escape(proposal?.verify ?? '')}`,
    '',
    '*근거*',
    ...judgement.citations.map(
      (citation) =>
        `• \`${citation.filePath}:${citation.startLine}-${citation.endLine}\` — ${escape(citation.why)}`,
    ),
    '',
    `✅ 승인 시 \`${escape(repo)}\` 에 issue 가 생성됩니다. 구현은 하지 않습니다.`,
  ].join('\n');
};
