// Slack 멘션 prefix `<@U....>` 를 모두 제거 + 앞뒤 공백 trim.
// (사용자가 "<@BOT> 안녕" 형태로 보낸 경우 "안녕" 만 추출.)
export const stripMentionPrefix = (text: string): string =>
  text.replace(/<@[A-Z0-9]+>\s*/g, '').trim();
