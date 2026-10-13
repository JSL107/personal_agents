import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parsePlayStoreSearch } from './play-store.parser';

describe('parsePlayStoreSearch', () => {
  it('pairs real app names with their card icons', () => {
    const html = readFileSync(
      join(__dirname, '__fixtures__/play-search.html'),
      'utf8',
    );
    const apps = parsePlayStoreSearch(html);
    expect(apps[0].name).toBe('카오스 제로 나이트메어');
    expect(apps[0].iconUrl).toMatch(
      /^https:\/\/play-lh.googleusercontent.com\/[^=]+$/,
    );
  });
});
