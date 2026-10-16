import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  parseCompanyPageUrl,
  parseGamejobList,
  parsePostingBodyText,
  parseRecruitDataText,
  parseRepresentativeGameText,
} from './gamejob.parser';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

describe('gamejob parser', () => {
  it('상세 페이지에서 모집분야·키워드·게임분야만 뽑는다', () => {
    const text = parseRecruitDataText(
      fixture('gamejob-detail-recruit-data.html'),
    );
    expect(text.split('\n')).toEqual([
      '모집분야: 게임개발(모바일), 원화',
      '키워드: 모바일, 배경, 배경원화',
      '게임분야: 모바일게임 RPG, Casual',
    ]);
    expect(text).not.toContain('툴팁');
  });

  it('iframe 본문 텍스트만 읽고 title/style 은 빼며 공백을 접는다', () => {
    const text = parsePostingBodyText(fixture('gamejob-body-ifrm.html'));
    expect(text).toContain('3DS MAX');
    expect(text).not.toContain('채용공고 상세페이지');
    expect(text).not.toMatch(/\s{2}/);
  });
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

describe('회사 정보 파싱', () => {
  it('공고 상세에서 회사 정보 페이지 주소를 찾는다', () => {
    expect(
      parseCompanyPageUrl('<a href="/Company/Detail?M=34960030">회사</a>'),
    ).toBe('https://www.gamejob.co.kr/Company/Detail?M=34960030');
    expect(parseCompanyPageUrl('<div></div>')).toBeNull();
  });

  // 실측(2026-10-15) 회사 정보 페이지의 마크업 — 값이 span 안에 있고 더보기 주석이 붙는다.
  it('「대표게임」 칸의 값을 읽고, 비었거나 - 이면 null', () => {
    const page = (value: string) =>
      `<dl><dt class="tit">기업형태</dt><dd>벤처기업</dd><dt class="tit">대표게임</dt><dd><span class="ellipsis">${value}</span><!--// 더보기 레이어 --></dd><dt class="tit">주요사업</dt><dd>게임</dd></dl>`;
    expect(
      parseRepresentativeGameText(page('\n  이세계 용병단 키우기\n')),
    ).toBe('이세계 용병단 키우기');
    expect(parseRepresentativeGameText(page('-'))).toBeNull();
    expect(parseRepresentativeGameText('<dl></dl>')).toBeNull();
  });
});
