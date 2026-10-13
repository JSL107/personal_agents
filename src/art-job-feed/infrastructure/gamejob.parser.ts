import * as cheerio from 'cheerio';

import { ArtJobListing, ArtJobListResult } from '../domain/art-job-feed.type';

const tidy = (text: string): string => text.replace(/\s+/g, ' ').trim();
const EMPLOYMENT_TYPES =
  /정규직|계약직|인턴|프리랜서|파견직|아르바이트|위촉직|병역특례/;
const LOCATION_PREFIX =
  /^(서울|경기|인천|부산|대구|광주|대전|울산|세종|강원|충북|충남|전북|전남|경북|경남|제주|전국|해외|재택)/;

export const parseGamejobList = (html: string): ArtJobListResult => {
  const $ = cheerio.load(`<table>${html}</table>`);
  const ids = new Set<string>();
  const listings: ArtJobListing[] = [];
  $('a[href*="GI_No="]').each((_, element) => {
    const sourceId = /[?&]GI_No=(\d+)/.exec($(element).attr('href') ?? '')?.[1];
    if (!sourceId || ids.has(sourceId)) {
      return;
    }
    ids.add(sourceId);
    const row = $(element).closest('tr');
    const argumentsText = $(element).attr('onclick') ?? '';
    const match =
      /GA_Application_Prdt\(\s*'[^']*'\s*,\s*'[^']*'\s*,\s*'((?:\\'|[^'])*)'\s*,\s*'\d+'\s*,\s*'((?:\\'|[^'])*)'/.exec(
        argumentsText,
      );
    const linkTitle = tidy($(element).text());
    const title =
      linkTitle.endsWith('...') && match ? tidy(match[1]) : linkTitle;
    const company = tidy(
      match?.[2] ?? row.find('.company strong').first().text(),
    );
    if (!title || !company) {
      return;
    }
    const information = row
      .find('p.info span')
      .map((_, span) => tidy($(span).text()))
      .get();
    const career =
      information.find(
        (value) => value.includes('신입') || value.includes('경력'),
      ) ?? null;
    const employmentTypes = information.filter((value) =>
      EMPLOYMENT_TYPES.test(value),
    );
    const location = information.find(
      (value) => value.includes('>') || LOCATION_PREFIX.test(value),
    );
    listings.push({
      sourceId,
      title,
      company,
      detailUrl: `https://www.gamejob.co.kr/Recruit/GI_Read/View?GI_No=${sourceId}`,
      deadlineText:
        tidy(row.find('.date').first().text()) ||
        tidy(row.find('.dday').first().text()) ||
        null,
      career,
      employmentType: employmentTypes.length
        ? employmentTypes.join(' · ')
        : null,
      location: location ? tidy(location.replace(/\s*>\s*/g, ' ')) : null,
    });
  });
  return { received: ids.size, listings };
};
