import * as cheerio from 'cheerio';

export interface ParsedPage {
  title: string;
  description: string;
}

// TODO: 크롤링 타겟의 DOM 구조에 맞추어 셀렉터/추출 방식을 구성하세요.
// url 파라미터는 도메인별 분기 처리가 필요할 때 활용합니다.
export const crawlerParser = (html: string, url: string): ParsedPage => {
  const $ = cheerio.load(html);

  const title = $('title').text();
  const description = $('meta[name="description"]').attr('content') ?? '';

  return { title, description };
};
