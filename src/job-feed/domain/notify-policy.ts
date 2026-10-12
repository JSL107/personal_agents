// 공고 알림 후보를 고르는 기준. 수집(job-feed)·갭 분석(job-feed-gap)·아침 한 통(morning-briefing)이
// 같은 값을 써야 한다 — 한쪽만 바뀌면 아침에 뜬 공고와 갭 분석 대상이 서로 다른 목록이 된다.

// 실측 분포(228건 중 80~100:95 · 60~79:117 · 40~59:14 · 20~39:2) 기준 — 60점은
// 93%가 통과해 필터 구실을 못 한다(Task 17, .env.example JOB_FEED_MATCH_THRESHOLD=80).
export const DEFAULT_JOB_MATCH_THRESHOLD = 80;
export const DEFAULT_JOB_NOTIFY_LIMIT = 10;
