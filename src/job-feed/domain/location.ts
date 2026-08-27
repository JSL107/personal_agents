import { JobSourceId } from './job-feed.type';

// 랠릿은 시도가 아니라 영문 구역 코드를 준다. 실측 분포(100건): GANGNAM 52 · SEOUL 19
// · GURO_GASAN 9 · MAPO 7 · PANGYO 5 · GYEONGGI 5 · ETC 3.
// 문자열 포함 검사로는 한글 시도명과 겹치지 않아 대응표가 필요하다.
const PROVINCE_BY_RALLIT_REGION: ReadonlyMap<string, string> = new Map([
  ['SEOUL', '서울'],
  ['GANGNAM', '서울'],
  ['GURO_GASAN', '서울'],
  ['MAPO', '서울'],
  ['JAMSIL_SONGPA', '서울'],
  ['YEOUIDO', '서울'],
  ['PANGYO', '경기'],
  ['GYEONGGI', '경기'],
  ['INCHEON', '인천'],
  ['BUSAN', '부산'],
  ['DAEGU', '대구'],
  ['DAEJEON', '대전'],
  ['GWANGJU', '광주'],
  ['ULSAN', '울산'],
  ['SEJONG', '세종'],
  ['JEJU', '제주'],
]);

const dedupe = (values: string[]): string[] => {
  return [...new Set(values)];
};

export const resolveLocations = (
  source: JobSourceId,
  raw: string[],
): string[] => {
  const resolved: string[] = [];

  for (const item of raw) {
    const trimmed = item.trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (source === 'rallit') {
      const province = PROVINCE_BY_RALLIT_REGION.get(trimmed.toUpperCase());
      if (province !== undefined) {
        resolved.push(province);
      }
      continue;
    }
    // 점핏은 "경기 성남시 분당구", 원티드는 "서울" — 둘 다 첫 토큰이 시도다.
    const [province] = trimmed.split(/\s+/u);
    if (province !== undefined && province.length > 0) {
      resolved.push(province);
    }
  }

  return dedupe(resolved);
};
