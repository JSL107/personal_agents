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
  // 카드 제목에 적을 KST 캘린더 날짜(YYYY-MM-DD). orchestrator 가 슬롯마다 한 번
  // 계산해 넘기는 값을 그대로 받는다(AutopilotTaskContext.firedAtKst) — 여기서 다시
  // 재면 자정 근처에 제목과 각주의 날짜가 갈릴 수 있다.
  firedAtKst: string;
}

// 카드는 두 조각으로 나간다 — 메인 메시지(제목·날짜·진단 각주)와 스레드 댓글(공고 목록).
// 열 건을 메인에 그대로 실으면 채널 한 화면을 통째로 차지해 다른 대화를 밀어낸다.
export interface JobFeedDigestText {
  summary: string;
  // 붙일 공고가 없으면 null — orchestrator 는 detail 이 있을 때만 스레드 댓글을 단다.
  detail: string | null;
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

// 카드에 적는 기술 개수 상한.
const MAX_SKILL_TAGS = 4;

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

const CARD_DATE_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: 'long',
  day: 'numeric',
  weekday: 'short',
});

// "2026-08-31" 을 그대로 제목에 붙이면 오늘 카드인지 한눈에 안 들어온다 — 요일까지 붙여
// "8월 31일 (월)" 로 읽히게 한다. 파싱할 수 없는 값이면 원문을 그대로 둔다: 날짜를 통째로
// 빼면 어느 날 카드인지 알 수 없어지고, 그건 형식이 어긋난 것보다 나쁘다.
const formatCardDate = (firedAtKst: string): string => {
  // 오프셋을 명시해 KST 자정으로 고정한다. "2026-08-31" 만 넘기면 UTC 자정으로 파싱돼
  // 서버 timezone 에 따라 하루 전으로 표시될 수 있다.
  const parsed = new Date(`${firedAtKst}T00:00:00+09:00`);
  if (Number.isNaN(parsed.getTime())) {
    return firedAtKst;
  }
  return CARD_DATE_FORMATTER.format(parsed);
};

export const formatJobFeedDigest = ({
  postings,
  outcomes,
  unmatchedSkillTags,
  lastCollectedAt,
  firedAtKst,
  scoreSkipReason = null,
}: JobFeedDigestInput): JobFeedDigestText => {
  const cardDate = formatCardDate(firedAtKst);
  const summaryLines: string[] = [];

  if (postings.length === 0) {
    summaryLines.push(`*새 백엔드 공고* — ${cardDate}`);
    summaryLines.push('조건에 맞는 공고가 없습니다.');
  } else {
    summaryLines.push(`*새 백엔드 공고 ${postings.length}건* — ${cardDate}`);
  }

  // 각주는 메인에 남긴다. 스레드로 내리면 접힌 채라, 수집이 멈췄다는 신호를 펼쳐 보기
  // 전까지 아무도 못 본다 — 이 각주들이 존재하는 이유가 바로 그 조용한 실패를 드러내는
  // 것이다(lastCollectedAt·scoreSkipReason 주석 참조).
  summaryLines.push('');
  summaryLines.push(formatLastCollectedAt(lastCollectedAt));

  if (scoreSkipReason) {
    summaryLines.push(`_⚠️ 채점 건너뜀 — ${scoreSkipReason}_`);
  }

  if (outcomes.length > 0) {
    summaryLines.push(`_수집: ${outcomes.map(formatOutcome).join(' · ')}_`);
  }

  if (unmatchedSkillTags.length > 0) {
    const preview = unmatchedSkillTags
      .slice(0, 5)
      .map((entry) => `${escapeMrkdwn(entry.tag)}×${entry.count}`)
      .join(', ');
    summaryLines.push(`_사전 미등록 기술: ${preview}_`);
  }

  const detailLines: string[] = [];
  for (const posting of postings) {
    // 기술은 네 개까지만 적는다. 여섯 개를 다 늘어놓으면 그 줄이 화면을 가로질러
    // 회사명보다 무거워진다 — 카드는 고를 거리를 주는 자리지 명세를 옮기는 자리가 아니다.
    const skills =
      posting.skillTags.length === 0
        ? '스킬 정보 없음'
        : posting.skillTags.slice(0, MAX_SKILL_TAGS).join(' · ');
    // 랠릿은 고정 지역 코드라 안전하지만, 점핏·원티드는 원본 문자열의 첫 토큰을
    // 그대로 쓰므로 회사명·제목과 마찬가지로 escape 없이는 특수문자가 노출될 수 있다.
    const location =
      posting.locations.length === 0
        ? ''
        : `${escapeMrkdwn(posting.locations.join('/'))} · `;
    // 회사명을 줄 맨 앞에 굵게 둔다. 예전엔 `[100점]` 배지가 앞자리였는데,
    // 알림은 점수 내림차순 상위 10건이고 만점 행이 수십 건 쌓여 있어 배지가
    // 사실상 항상 같은 값이었다 — 회사명 시작 위치만 줄마다 어긋나 세로로
    // 훑을 수 없었다.
    detailLines.push(
      `*${escapeMrkdwn(posting.company)}* — <${posting.detailUrl}|${escapeMrkdwn(
        posting.title,
      )}>`,
    );
    // 부속 정보는 인용 줄로 내린다. 슬랙이 왼쪽에 세로선을 그려 "위 회사에 딸린
    // 정보"라는 종속 관계가 위치가 아니라 선으로 보인다. 기울임(`_..._`)을 먼저
    // 썼다가 되돌렸다 — 슬랙 이탤릭은 색을 바꾸지 않아 눌러쓰기가 되지 않고,
    // 한글은 기울임체가 없어 강제로 비스듬히 그려지느라 오히려 읽기 나빠졌다.
    // 인용 줄은 덤으로 문장 분해에서도 보호받는다(mrkdwn.util 의 LIST_OR_QUOTE_LINE).
    detailLines.push(
      `> ${formatYears(posting.minYears, posting.maxYears)} · ${location}${escapeMrkdwn(skills)}`,
    );
  }

  return {
    summary: summaryLines.join('\n'),
    detail: detailLines.length === 0 ? null : detailLines.join('\n'),
  };
};
