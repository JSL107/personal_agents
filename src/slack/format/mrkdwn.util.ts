// Slack mrkdwn `<url|title>` 링크 안에 들어가는 텍스트가 `<` / `>` / `|` 를 포함하면 파싱이 깨진다.
// LLM 출력 (task.title) 이나 외부 CLI 결과 (modelUsed) 가 우연히 이 문자를 포함해도 footer/link 가 안 깨지도록
// 보수적으로 제거. 의미 손실은 미미하고 회귀 회피 효과 큼 (codex/omc P1 지적).
export const sanitizeForSlackLink = (text: string): string =>
  text.replace(/[<>|]/g, '');

// Slack mrkdwn `<url|...>` 안의 url 은 반드시 http(s) 스킴이어야 한다.
// LLM 이 fragment(`/pull/707`) 만 반환하는 사고를 막기 위해 prefix 화이트리스트 (codex P0 지적).
export const isSafeHttpUrl = (url: string): boolean =>
  url.startsWith('http://') || url.startsWith('https://');
