export interface KrxDelisting {
  code: string;
  name: string;
  market: 'KOSPI' | 'KOSDAQ';
  delistedAt: Date;
  reason: string;
}

const stripTags = (cell: string): string => {
  return cell
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
};

const parseDate = (text: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return null;
  }
  const candidate = new Date(`${text}T00:00:00.000Z`);
  // JS Date 는 2026-02-30 을 03-02 로 굴려 받는다. 문자열 왕복으로 되짚어야 걸러진다.
  if (
    Number.isNaN(candidate.getTime()) ||
    candidate.toISOString().slice(0, 10) !== text
  ) {
    return null;
  }
  return candidate;
};

export const parseKrxDelistingHtml = (
  html: string,
  market: 'KOSPI' | 'KOSDAQ',
): KrxDelisting[] => {
  // 같은 종목코드가 여러 번 폐지될 수 있다 — 코스닥에서 시장을 옮기며 한 번(이전상장),
  // 나중에 코스피에서 실제로 한 번(2026-09-01 실측 9건, 예: KTF 2004 이전 → 2009 해산).
  // 응답 순서는 폐지일 순이 아니므로(앞이 2001년, 끝이 2025년) 첫 행을 최신으로 믿으면 안 된다.
  // 최신 폐지가 그 종목의 결말이므로 날짜로 비교해 늦은 쪽을 남긴다.
  const latestByCode = new Map<string, KrxDelisting>();
  const rows = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? [];

  for (const row of rows) {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(
      (match) => stripTags(match[1]),
    );
    if (cells.length < 5) {
      continue;
    }

    const [, name, code, delistedAtText, reason] = cells;
    if (!/^\d{6}$/.test(code)) {
      continue;
    }
    const delistedAt = parseDate(delistedAtText);
    if (!delistedAt) {
      continue;
    }
    const previous = latestByCode.get(code);
    if (previous && previous.delistedAt.getTime() >= delistedAt.getTime()) {
      continue;
    }

    latestByCode.set(code, {
      code,
      name,
      market,
      delistedAt,
      // 사유는 원문 그대로 남긴다. 분류(합병 대가 / 부실 폐지)는 읽는 쪽 판단이고,
      // 여기서 좁히면 나중에 밴드를 다시 가를 때 원문이 남아 있지 않다.
      reason,
    });
  }

  if (latestByCode.size === 0) {
    throw new Error('KRX 상장폐지 목록에 유효한 행이 없습니다.');
  }

  return [...latestByCode.values()];
};
