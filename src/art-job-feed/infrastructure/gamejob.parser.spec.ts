import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseGamejobCompanyPhotos, parseGamejobList } from './gamejob.parser';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

describe('gamejob parser', () => {
  it('parses actual list rows and deduplicates IDs', () => {
    const html = fixture('gamejob-list.html');
    const result = parseGamejobList(html + html);
    expect(result.received).toBe(4);
    expect(result.listings).toHaveLength(4);
    expect(result.listings[2]).toMatchObject({
      sourceId: '285773',
      title: '[LOST ARK Mobile] 캐릭터컨셉(원화) 담당',
      company: '스마일게이트',
    });
  });
  it('restores the full title from onclick when link text is truncated', () => {
    const html = `<tr><td><div class="company"><strong>회사</strong></div></td><td><a href="/Recruit/GI_Read/View?GI_No=9" onclick="GA_Application_Prdt('click', 'N', '캐릭터 원화 전체 제목', '9', '회사')">캐릭터 원화...</a></td></tr>`;
    expect(parseGamejobList(html).listings[0].title).toBe(
      '캐릭터 원화 전체 제목',
    );
  });
  it('extracts original company photos', () => {
    const photos = parseGamejobCompanyPhotos(fixture('gamejob-detail.html'));
    expect(photos).toHaveLength(6);
    expect(photos[0]).toContain('/OriginalView?FN=');
    expect(photos[0]).not.toMatch(/&\d+$/);
  });
});
