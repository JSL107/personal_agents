import { ArtJobListing } from '../domain/art-job-feed.type';
import {
  formatArtJobDigest,
  formatArtJobImageCaption,
  formatArtJobPreviewCaption,
} from './art-job-feed.formatter';

const TODAY = { year: 2026, month: 10, day: 13 };

const LISTING: ArtJobListing = {
  sourceId: '283904',
  company: '스마일게이트 & 슈퍼크리에이티브',
  title: '[카오스 제로 나이트메어] 캐릭터 원화 <급구> | 정규직',
  detailUrl: 'https://www.gamejob.co.kr/Recruit/GI_Read/View?GI_No=283904',
  deadlineText: '오늘마감',
  career: '경력3년↑',
  employmentType: '정규직',
  location: '경기 성남시',
};

describe('formatArtJobDigest', () => {
  it('머리(멘션)와 번호 붙은 공고 목록을 한 통으로 만든다', () => {
    const text = formatArtJobDigest({
      mentionUserId: 'U9',
      today: TODAY,
      items: [
        {
          listing: LISTING,
          resolved: {
            gameTitle: '카오스 제로 나이트메어',
            image: {
              url: 'https://play-lh.example/x=w512',
              origin: 'PLAY_STORE',
            },
            googleSearchUrl: null,
          },
        },
        {
          listing: {
            ...LISTING,
            sourceId: '2',
            title: '[프로젝트 A] 캐릭터 컨셉',
            company: '그레이게임즈',
            deadlineText: '채용시',
            career: null,
            employmentType: null,
            location: null,
          },
          resolved: { gameTitle: null, image: null, googleSearchUrl: null },
        },
      ],
    });

    expect(text).toBe(
      [
        '🎨 <@U9> 게임잡 새 원화 공고 *2건*',
        [
          '*1. <https://www.gamejob.co.kr/Recruit/GI_Read/View?GI_No=283904|[카오스 제로 나이트메어] 캐릭터 원화 급구  정규직>*',
          '스마일게이트 &amp; 슈퍼크리에이티브 · 경력3년↑ · 정규직 · 경기 성남시 · 🔥 *오늘 마감*',
          '🎮 카오스 제로 나이트메어 · 이미지는 스레드에',
        ].join('\n'),
        [
          '*2. <https://www.gamejob.co.kr/Recruit/GI_Read/View?GI_No=283904|[프로젝트 A] 캐릭터 컨셉>*',
          '그레이게임즈 · 상시',
        ].join('\n'),
        '_관심 없는 공고는 이 메시지에 번호 이모지(1️⃣~🔟)를 달아 주세요. 같은 공고가 다시 올라와도 보내지 않아요._',
      ].join('\n\n'),
    );
  });

  it('이미지가 없으면 게임명 옆에 구글 이미지 검색 링크를 단다', () => {
    const text = formatArtJobDigest({
      mentionUserId: null,
      today: TODAY,
      items: [
        {
          listing: LISTING,
          resolved: {
            gameTitle: 'LOST ARK Mobile',
            image: null,
            googleSearchUrl: 'https://www.google.com/search?tbm=isch&q=x',
          },
        },
      ],
    });
    expect(text.startsWith('🎨 게임잡 새 원화 공고 *1건*')).toBe(true);
    expect(text).toContain(
      '🎮 LOST ARK Mobile · <https://www.google.com/search?tbm=isch&q=x|구글 이미지 검색>',
    );
    // 멘션 대상이 없으면 리액션 핸들러가 꺼져 있으므로 제외 안내도 싣지 않는다.
    expect(text).not.toContain('번호 이모지');
  });
});

describe('formatArtJobImageCaption', () => {
  it('플레이스토어 아이콘은 번호와 게임명만 싣는다', () => {
    expect(
      formatArtJobImageCaption(3, 'A&B', {
        url: 'https://x',
        origin: 'PLAY_STORE',
      }),
    ).toBe('3. 🎮 A&amp;B');
  });

  it('검색으로 찾은 그림은 참고 이미지와 출처를 밝힌다', () => {
    expect(
      formatArtJobImageCaption(2, 'LOST ARK Mobile', {
        url: 'https://x',
        origin: 'KAKAO_IMAGE',
        sourceName: '인벤',
      }),
    ).toBe('2. 🎮 LOST ARK Mobile · 참고 이미지 (출처: 인벤)');
  });
});

describe('formatArtJobDigest — 검색 미리보기', () => {
  it('게임명이 없어도 미리보기·구글 링크를 한 줄로 알린다', () => {
    const text = formatArtJobDigest({
      mentionUserId: null,
      today: TODAY,
      items: [
        {
          listing: LISTING,
          resolved: {
            gameTitle: null,
            image: null,
            preview: {
              url: 'https://x',
              origin: 'SEARCH_PREVIEW',
              sourceName: '게임포커스',
            },
            searchQuery: '그레이게임즈 게임',
            googleSearchUrl: 'https://www.google.com/search?tbm=isch&q=y',
          },
        },
      ],
    });
    expect(text).toContain(
      '🔎 검색 미리보기는 스레드에 · <https://www.google.com/search?tbm=isch&q=y|구글 이미지 검색>',
    );
  });
});

describe('formatArtJobPreviewCaption', () => {
  it('확인 안 된 이미지임과 검색어·출처를 밝힌다', () => {
    expect(
      formatArtJobPreviewCaption(5, '팀 테트라포드 게임', {
        url: 'https://x',
        origin: 'SEARCH_PREVIEW',
        sourceName: '게임포커스',
      }),
    ).toBe(
      '5. 🔎 검색 미리보기 · 확인 안 된 이미지 (검색어: 팀 테트라포드 게임 · 출처: 게임포커스)',
    );
  });
});
