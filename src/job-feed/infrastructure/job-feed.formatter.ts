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
  // ScoreJobPostingsUsecase.execute 가 skipped=true 를 돌려줬을 때의 사유. 채점 자체를
  // 안 한 것과 "채점했지만 기준 통과 공고가 없음"은 다른 원인인데, 이 필드가 없으면
  // 둘 다 "조건에 맞는 공고가 없습니다"로 똑같이 보인다 — 수집은 성공했으니 각주(마지막
  // 수집 시각)도 정상으로 보여 "조용한 0건"이 다른 원인으로 재발한다.
  scoreSkipReason?: string | null;
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
  scoreSkipReason = null,
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
          : `${escapeMrkdwn(posting.locations.join('/'))} · `;
      // 건과 건 사이를 빈 줄로 끊는다. 열 건이 같은 간격으로 붙어 있으면 어디서
      // 한 건이 끝나는지 보이지 않아 두 줄짜리 항목이 한 덩어리로 읽힌다.
      lines.push('');
      // 회사명을 줄 맨 앞에 굵게 둔다. 예전엔 `[100점]` 배지가 앞자리였는데,
      // 알림은 점수 내림차순 상위 10건이고 만점 행이 수십 건 쌓여 있어 배지가
      // 사실상 항상 같은 값이었다 — 회사명 시작 위치만 줄마다 어긋나 세로로
      // 훑을 수 없었다. 점수는 값이 갈릴 때만 쓸모가 있으므로 메타 줄 끝으로 옮긴다.
      lines.push(
        `*${escapeMrkdwn(posting.company)}* — <${posting.detailUrl}|${escapeMrkdwn(
          posting.title,
        )}>`,
      );
      // 연차·지역·스킬·점수는 회사명을 고른 뒤에 보는 부속 정보다. 기울임으로
      // 눌러 두지 않으면 본문과 같은 무게라 회사명과 시선을 두고 경쟁한다.
      lines.push(
        `_${formatYears(posting.minYears, posting.maxYears)} · ${location}${escapeMrkdwn(skills)} · ${posting.matchScore ?? 0}점_`,
      );
    }
  }

  lines.push('');
  lines.push(formatLastCollectedAt(lastCollectedAt));

  if (scoreSkipReason) {
    lines.push(`_⚠️ 채점 건너뜀 — ${scoreSkipReason}_`);
  }

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
