export interface KrxListing {
  code: string;
  name: string;
  market: 'KOSPI' | 'KOSDAQ';
  sector: string | null;
  listedAt: Date | null;
}

export const parseKrxListingHtml = (
  html: string,
  market: 'KOSPI' | 'KOSDAQ',
): KrxListing[] => {
  const listings: KrxListing[] = [];
  const seenCodes = new Set<string>();
  const rows = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? [];

  for (const row of rows) {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(
      (match) => match[1].replace(/<[^>]*>/g, '').trim(),
    );
    if (cells.length < 10) {
      continue;
    }

    const [name, marketCell, code, sector, , listedAtText] = cells;
    if (!/^\d{6}$/.test(code)) {
      continue;
    }
    // KRX 실응답은 완전히 같은 법인 행을 중복해서 주므로 첫 행만 authoritative로 쓴다.
    if (seenCodes.has(code)) {
      continue;
    }
    seenCodes.add(code);

    let listingMarket = market;
    if (marketCell === '유가') {
      listingMarket = 'KOSPI';
    } else if (marketCell === '코스닥') {
      listingMarket = 'KOSDAQ';
    }

    let listedAt: Date | null = null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(listedAtText)) {
      const candidate = new Date(`${listedAtText}T00:00:00.000Z`);
      if (
        !Number.isNaN(candidate.getTime()) &&
        candidate.toISOString().slice(0, 10) === listedAtText
      ) {
        listedAt = candidate;
      }
    }

    listings.push({
      code,
      name,
      market: listingMarket,
      sector: sector || null,
      listedAt,
    });
  }

  if (listings.length === 0) {
    throw new Error('KRX 상장법인 목록에 유효한 행이 없습니다.');
  }

  return listings;
};
