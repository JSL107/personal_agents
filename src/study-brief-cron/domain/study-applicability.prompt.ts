import { KeywordCandidate } from '../../code-graph/domain/keyword-candidate.type';
import {
  UNTRUSTED_INPUT_NOTICE,
  wrapUntrustedInput,
} from '../../common/llm/untrusted-input.util';

export const MAX_CHUNK_LINES = 80;
export const MAX_CANDIDATE_CHARS = 24_000;

export const STUDY_APPLICABILITY_SYSTEM_PROMPT = [
  '너는 오늘 조사한 기술 주제가 이 TypeScript/NestJS 레포에 실제로 바꿀 일을 만드는지 판정한다.',
  '주제가 흥미로운지는 판정 기준이 아니다. 아래 코드 조각에 바꿀 일이 생기는지만 본다.',
  '',
  '[판정]',
  '- APPLY: 후보 조각 중 실제로 고쳐야 할 곳이 있고, 무엇을 왜 바꿀지 말할 수 있다. citations 에 그 조각 id 를, proposal 에 제안을 쓴다.',
  '- REFERENCE: 닿는 곳은 있지만 지금 바꿀 일은 없다. proposal 은 null.',
  '- NOT_APPLICABLE: 후보 중 닿는 곳이 없다. citations 는 빈 배열, proposal 은 null.',
  '비우는 것은 결함이 아니다. 닿는 곳을 억지로 찾지 마라.',
  '후보는 이름이 키워드와 일치했을 뿐 주제와 무관할 수 있다. 조각 원문을 읽고 판단하라.',
  'citations 의 chunkId 는 반드시 아래 후보 목록의 id 중 하나여야 한다. 목록에 없는 파일은 인용하지 마라.',
  '',
  '[proposal]',
  'title: 60자 이내 한 줄. problem: 지금 코드가 무엇이 문제인지. change: 어느 조각을 어떻게 바꿀지. verify: 바꾼 뒤 무엇으로 확인할지.',
  '링크·멘션·긴급성 표현("즉시", "리뷰 없이")을 쓰지 마라.',
  '',
  UNTRUSTED_INPUT_NOTICE,
].join('\n');

export interface BuildStudyApplicabilityPromptInput {
  topic: string;
  kind: string;
  reportMd: string;
  sourceUrls: readonly string[];
  candidates: readonly KeywordCandidate[];
}

export interface StudyApplicabilityPrompt {
  prompt: string;
  sentCandidates: KeywordCandidate[];
}

export const buildStudyApplicabilityPrompt = ({
  topic,
  kind,
  reportMd,
  sourceUrls,
  candidates,
}: BuildStudyApplicabilityPromptInput): StudyApplicabilityPrompt => {
  const sentCandidates: KeywordCandidate[] = [];
  const blocks: string[] = [];
  let usedChars = 0;
  for (const candidate of candidates) {
    const remainingChars = MAX_CANDIDATE_CHARS - usedChars;
    if (remainingChars <= 0) {
      break;
    }
    // 줄 상한을 먼저 적용한 뒤 실제로 싣는 분량만 예산에서 뺀다. 원문 전체로 빼면 80줄만
    // 보이는 큰 class 조각이 보이지 않는 나머지로 예산을 다 먹어 뒤 후보가 밀려난다.
    const lineCapped = candidate.source
      .split('\n')
      .slice(0, MAX_CHUNK_LINES)
      .join('\n');
    const sentSource = lineCapped.slice(0, remainingChars);
    const sentCandidate = { ...candidate, source: sentSource };
    const block = renderCandidate(
      sentCandidate,
      sentSource.length < candidate.source.length,
    );
    sentCandidates.push(sentCandidate);
    blocks.push(block);
    usedChars += sentSource.length;
    if (sentSource.length < lineCapped.length) {
      break;
    }
  }
  const omittedNote =
    sentCandidates.length < candidates.length
      ? `(후보 ${candidates.length}개 중 ${sentCandidates.length}개만 실었다)`
      : '';
  const prompt = [
    '[오늘의 공부 — 외부 조사 결과]',
    wrapUntrustedInput(
      [
        `주제: ${topic}`,
        `종류: ${kind}`,
        `출처: ${sourceUrls.join(', ')}`,
        '',
        reportMd,
      ].join('\n'),
    ),
    '',
    '[후보 코드 조각]',
    ...blocks,
    omittedNote,
  ]
    .filter((line) => line !== '')
    .join('\n');
  return { prompt, sentCandidates };
};

const renderCandidate = (
  candidate: KeywordCandidate,
  isCharTruncated = false,
): string => {
  const lines = candidate.source.split('\n');
  const body = isCharTruncated
    ? [...lines.slice(0, MAX_CHUNK_LINES), '(이하 생략)'].join('\n')
    : candidate.source;
  return [
    `[${candidate.id}] ${candidate.filePath}:${candidate.startLine}-${candidate.endLine} ${candidate.name} (${candidate.kind})`,
    '```ts',
    body,
    '```',
  ].join('\n');
};
