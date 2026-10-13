import * as cheerio from 'cheerio';

export interface PlayStoreApp {
  name: string;
  iconUrl: string;
}

export const parsePlayStoreSearch = (html: string): PlayStoreApp[] => {
  const $ = cheerio.load(html);
  const apps: PlayStoreApp[] = [];
  $('a[href*="/store/apps/details"][aria-label]').each((_, element) => {
    const card = $(element).parent();
    const name = $(element).attr('aria-label')?.trim();
    const icon = card
      .find('img[src^="https://play-lh.googleusercontent.com/"]')
      .first()
      .attr('src');
    if (name && icon) {
      apps.push({ name, iconUrl: icon.replace(/=.*/, '') });
    }
  });
  return apps;
};
