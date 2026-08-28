import { UnmatchedSkillTag } from '../application/collect-job-postings.usecase';
import { JobSourceId, SourceFetchOutcome } from '../domain/job-feed.type';
import { StoredJobPosting } from '../domain/port/job-posting.repository.port';

// UnmatchedSkillTag 는 Task 10 에서 정의한 것을 그대로 쓴다. 여기서 다시 선언하면
// 형태가 갈릴 때 타입 검사가 못 잡는다.

export interface JobFeedDigestInput {
  postings: StoredJobPosting[];
  outcomes: SourceFetchOutcome[];
  unmatchedSkillTags: UnmatchedSkillTag[];
  // 조회 계층(findScoringTargets 등)이 lastSeenAt 신선도 조건(이틀)을 걸기
  // 시작하면서, 수집이 이틀 넘게 실패하면 postings 조회가 조용히 텅 비어
  // "오늘은 조건에 맞는 공고 없음"으로 보인다. 실제 원인은 수집기 장애인데
  // 카드만 보면 구분할 수 없어, 마지막 수집 시각을 각주에 반드시 남긴다.
  lastCollectedAt: Date | null;
}

const SOURCE_LABEL: Readonly<Record<JobSourceId, string>> = {
  jumpit: '점핏',
  rallit: '랠릿',
  wanted: '원티드',
};

// 회사명·제목은 외부에서 온 문자열이라 mrkdwn 제어문자가 섞일 수 있다.
// job-feed-gap.autopilot-task.ts 도 같은 출처(company/title)를 카드에 실으므로 재사용한다.
export const escapeMrkdwn = (value: string): string => {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/[*_~`]/gu, '');
};

const formatYears = (
  minYears: number | null,
  maxYears: number | null,
): string => {
  if (minYears === null && maxYears === null) {
    return '경력 무관';
  }
  if (maxYears === null) {
    return `${minYears ?? 0}년 이상`;
  }
  if (minYears === null) {
    return `${maxYears}년 이하`;
  }
  return `${minYears}~${maxYears}년`;
};

const formatOutcome = (outcome: SourceFetchOutcome): string => {
  const label = SOURCE_LABEL[outcome.source] ?? outcome.source;
  if (outcome.status === 'FAILED') {
    return `${label} 실패(${outcome.error ?? '사유 미상'})`;
  }
  return `${label} ${outcome.accepted}건`;
};

const STALE_COLLECTION_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;

const LAST_COLLECTED_AT_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

// 마지막 수집 시각이 없거나 오래됐으면 카드 자체가 "조회 결과 없음"으로 보이는
// 새 실패 모드(신선도 조건 도입 이후)를 이 각주 한 줄로 구분할 수 있게 한다.
const formatLastCollectedAt = (lastCollectedAt: Date | null): string => {
  if (lastCollectedAt === null) {
    return '_마지막 수집: 수집 기록 없음_';
  }

  const timestamp = LAST_COLLECTED_AT_FORMATTER.format(lastCollectedAt);
  const elapsedHours = Math.floor(
    (Date.now() - lastCollectedAt.getTime()) / HOUR_MS,
  );

  if (elapsedHours >= STALE_COLLECTION_HOURS) {
    return `_⚠️ 마지막 수집: ${timestamp} (${elapsedHours}시간 전 — 수집이 멈췄을 수 있습니다)_`;
  }
  return `_마지막 수집: ${timestamp}_`;
};

export const formatJobFeedDigest = ({
  postings,
  outcomes,
  unmatchedSkillTags,
  lastCollectedAt,
}: JobFeedDigestInput): string => {
  const lines: string[] = [];

  if (postings.length === 0) {
    lines.push('*새 백엔드 공고* — 조건에 맞는 공고가 없습니다.');
  } else {
    lines.push(`*새 백엔드 공고 ${postings.length}건*`);
    for (const posting of postings) {
      const skills =
        posting.skillTags.length === 0
          ? '스킬 정보 없음'
          : posting.skillTags.slice(0, 6).join(' · ');
      // 랠릿은 고정 지역 코드라 안전하지만, 점핏·원티드는 원본 문자열의 첫 토큰을
      // 그대로 쓰므로 회사명·제목과 마찬가지로 escape 없이는 특수문자가 노출될 수 있다.
      const location =
        posting.locations.length === 0
          ? ''
          : ` · ${escapeMrkdwn(posting.locations.join('/'))}`;
      lines.push(
        `• [${posting.matchScore ?? 0}점] <${posting.detailUrl}|${escapeMrkdwn(
          posting.company,
        )} — ${escapeMrkdwn(posting.title)}>`,
      );
      lines.push(
        `    ${formatYears(posting.minYears, posting.maxYears)}${location} · ${escapeMrkdwn(skills)}`,
      );
    }
  }

  lines.push('');
  lines.push(formatLastCollectedAt(lastCollectedAt));

  if (outcomes.length > 0) {
    lines.push(`_수집: ${outcomes.map(formatOutcome).join(' · ')}_`);
  }

  if (unmatchedSkillTags.length > 0) {
    const preview = unmatchedSkillTags
      .slice(0, 5)
      .map((entry) => `${escapeMrkdwn(entry.tag)}×${entry.count}`)
      .join(', ');
    lines.push(`_사전 미등록 기술: ${preview}_`);
  }

  return lines.join('\n');
};
