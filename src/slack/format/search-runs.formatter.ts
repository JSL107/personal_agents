import { SearchAgentRunsResult } from '../../agent-run/application/search-agent-runs.usecase';

// /search-runs 결과를 Slack mrkdwn 으로 압축.
// 구조:
//   *🔍 "<keyword>" 매칭 N건*
//
//   • [PM #42] 2026-05-30 — _발췌..._
//   • [CTO #38] 2026-05-29 — _발췌..._
//
//   _더 보고 싶다면 키워드를 좁히거나 /retry-run <id>._
export const formatSearchRuns = (result: SearchAgentRunsResult): string => {
  // 사용자가 입력한 keyword 자체에 mrkdwn meta 문자 / angle bracket 이 있을 수 있다 — header escape 필수.
  const safeKeyword = escapeMrkdwn(result.keyword);
  if (result.rows.length === 0) {
    return [
      `*🔍 "${safeKeyword}" 매칭 0건*`,
      '',
      '_본인 SUCCEEDED AgentRun 중 키워드를 포함한 결과가 없습니다. 키워드를 더 일반화하거나 직접 DB 를 조회해주세요._',
    ].join('\n');
  }

  const header = `*🔍 "${safeKeyword}" 매칭 ${result.rows.length}건${result.truncated ? ' (더 있을 수 있음)' : ''}*`;
  const lines = result.rows.map((row) => {
    const date = toShortDateKst(row.endedAt);
    return `• \`[${row.agentType} #${row.id}]\` ${date} — _${escapeMrkdwn(row.snippet)}_`;
  });
  const footer = result.truncated
    ? '_더 좁히려면 키워드 추가 / 또는 `/retry-run <id>` 로 재실행._'
    : '_`/retry-run <id>` 로 동일 입력 재실행 가능._';

  return [header, '', ...lines, '', footer].join('\n');
};

// YYYY-MM-DD (KST 기준) — 사용자가 한국 사용자라 UTC 표기는 자정 근처 KST 날짜와 1일 차이 발생.
// kst-date.util 은 "today" 전용이라 임의 Date 변환은 본 helper 에서 직접.
const toShortDateKst = (date: Date): string => {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
};

// Slack mrkdwn 의 메타 문자 + angle bracket / & — snippet (LLM 출력 가능) 과 사용자 keyword 입력 모두에 적용.
// `<URL|text>` 링크, `<@U...>` 멘션 형태가 사용자가 작성하지 않은 LLM output 에서 나타날 가능성을 차단.
const escapeMrkdwn = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([*_`])/g, '\\$1');
