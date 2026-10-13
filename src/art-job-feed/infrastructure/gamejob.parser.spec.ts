import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseGamejobList } from './gamejob.parser';

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
      career: '경력3년↑',
      employmentType: '정규직',
      location: '경기 성남시',
      deadlineText: '채용시',
    });
    expect(result.listings[3].employmentType).toBe('계약직');
  });
  it('restores the full title from onclick when link text is truncated', () => {
    const html = `<tr><td><div class="company"><strong>회사</strong></div></td><td><a href="/Recruit/GI_Read/View?GI_No=9" onclick="GA_Application_Prdt('click', 'N', '캐릭터 원화 전체 제목', '9', '회사')">캐릭터 원화...</a></td></tr>`;
    expect(parseGamejobList(html).listings[0].title).toBe(
      '캐릭터 원화 전체 제목',
    );
  });
  it('classifies reordered info and leaves missing values null', () => {
    const html = `<tr><td class="company"><strong>회사</strong></td><td><a href="?GI_No=8">공고</a><p class="info"><span>계약직</span><span>서울 &gt; 강남구</span><span>정규직</span><span>신입·경력</span></p></td><td><span class="modifyDate">어제 등록</span></td></tr><tr><td class="company"><strong>회사</strong></td><td><a href="?GI_No=9">공고</a><p class="info"><span>학력무관</span><span>모바일게임</span></p></td></tr>`;
    const [first, second] = parseGamejobList(html).listings;
    expect(first).toMatchObject({
      career: '신입·경력',
      employmentType: '계약직 · 정규직',
      location: '서울 강남구',
      deadlineText: null,
    });
    expect(second).toMatchObject({
      career: null,
      employmentType: null,
      location: null,
    });
  });
});
