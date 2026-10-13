import * as cheerio from 'cheerio';

import { ArtJobListing, ArtJobListResult } from '../domain/art-job-feed.type';

const tidy = (text: string): string => text.replace(/\s+/g, ' ').trim();

export const parseGamejobList = (html: string): ArtJobListResult => {
  const $ = cheerio.load(html);
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
    listings.push({
      sourceId,
      title,
      company,
      detailUrl: `https://www.gamejob.co.kr/Recruit/GI_Read/View?GI_No=${sourceId}`,
      deadlineText: tidy(row.find('.dday, .date').first().text()) || null,
    });
  });
  return { received: ids.size, listings };
};

export const parseGamejobCompanyPhotos = (html: string): string[] => {
  const $ = cheerio.load(html);
  const urls = new Set<string>();
  $('img[src]').each((_, element) => {
    const source = $(element).attr('src') ?? '';
    if (
      !source.includes('file.gamejob.co.kr/net/Corp/CoImage/') ||
      !source.includes('/VIew?FN=')
    ) {
      return;
    }
    urls.add(
      source
        .replace(/^\/\//, 'https://')
        .replace('/VIew?FN=', '/OriginalView?FN=')
        .replace(/&\d+$/, ''),
    );
  });
  return [...urls];
};
