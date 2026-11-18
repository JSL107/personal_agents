// ISO 시각 문자열 중 가장 늦은 것. 비교만 하고 원래 문자열을 그대로 돌려준다.
export const pickLatestDateTime = (dates: [string, ...string[]]): string =>
  dates.reduce((found, date) =>
    Date.parse(date) > Date.parse(found) ? date : found,
  );
