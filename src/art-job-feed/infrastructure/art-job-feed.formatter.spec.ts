import { ArtJobListing } from '../domain/art-job-feed.type';
import {
  formatArtJobDeadlineReminder,
  formatArtJobDigest,
  formatArtJobImageCaption,
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
  it('머리(멘션)와 번호 붙은 공고 목록을 한 통으로 만들고 공고마다 버튼 줄을 단다', () => {
    const message = formatArtJobDigest({
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

    expect(
      message.text.startsWith('🎨 <@U9> 게임잡 새 원화 공고 *2건*\n\n*1. <'),
    ).toBe(true);
    expect(message.text).toContain('그레이게임즈 · 상시');
    expect(message.text).not.toContain('관심 없음');
    expect(message.blocks).toEqual([
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '🎨 <@U9> 게임잡 새 원화 공고 *2건*' },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            '*1. <https://www.gamejob.co.kr/Recruit/GI_Read/View?GI_No=283904|[카오스 제로 나이트메어] 캐릭터 원화 급구  정규직>*',
            '스마일게이트 &amp; 슈퍼크리에이티브 · 경력3년↑ · 정규직 · 경기 성남시 · 🔥 *오늘 마감*',
            '🎮 카오스 제로 나이트메어 · 이미지는 스레드에',
          ].join('\n'),
        },
      },
      // 오늘 마감은 전날이 지났으므로 「관심 있음」 없이 「관심 없음」만.
      {
        type: 'actions',
        block_id: 'art-job:283904',
        elements: [
          {
            type: 'button',
            action_id: 'art_job_exclude',
            text: { type: 'plain_text', text: '관심 없음' },
            value: '283904',
          },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            '*2. <https://www.gamejob.co.kr/Recruit/GI_Read/View?GI_No=283904|[프로젝트 A] 캐릭터 컨셉>*',
            '그레이게임즈 · 상시',
          ].join('\n'),
        },
      },
      // 상시는 마감 전날을 정할 수 없다.
      {
        type: 'actions',
        block_id: 'art-job:2',
        elements: [
          {
            type: 'button',
            action_id: 'art_job_exclude',
            text: { type: 'plain_text', text: '관심 없음' },
            value: '2',
          },
        ],
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '마음에 드는 공고는 *관심 있음* 을 누르면 마감 전날 DM 으로 알려 드려요. 관심 없는 공고는 *관심 없음* 을 누르면 같은 공고가 다시 올라와도 보내지 않아요.',
          },
        ],
      },
    ]);
  });

  it('마감일이 내일 이후인 공고에는 「관심 있음」을 앞에 단다', () => {
    const { blocks } = formatArtJobDigest({
      mentionUserId: 'U9',
      today: TODAY,
      items: [
        {
          listing: { ...LISTING, deadlineText: '~10/31(금)' },
          resolved: { gameTitle: null, image: null, googleSearchUrl: null },
        },
      ],
    });

    expect(blocks[2]).toEqual({
      type: 'actions',
      block_id: 'art-job:283904',
      elements: [
        {
          type: 'button',
          action_id: 'art_job_interest',
          text: { type: 'plain_text', text: '⭐ 관심 있음' },
          value: '283904',
        },
        {
          type: 'button',
          action_id: 'art_job_exclude',
          text: { type: 'plain_text', text: '관심 없음' },
          value: '283904',
        },
      ],
    });
  });

  it('이미지가 없으면 게임명 옆에 구글 이미지 검색 링크를 단다', () => {
    const { text: header, blocks } = formatArtJobDigest({
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
    const text = JSON.stringify(blocks);
    expect(header.startsWith('🎨 게임잡 새 원화 공고 *1건*\n\n')).toBe(true);
    expect(text).toContain(
      '🎮 LOST ARK Mobile · <https://www.google.com/search?tbm=isch&q=x|구글 이미지 검색>',
    );
    // 멘션 대상이 없으면 누를 수 있는 사람이 없으므로 버튼도 안내도 싣지 않는다.
    expect(text).not.toContain('"actions"');
    expect(text).not.toContain('관심 없음');
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

describe('formatArtJobDigest — 확인 못 한 이미지', () => {
  it('게임명이 없으면 구글 링크만 알리고 미리보기 안내는 없다', () => {
    const { blocks } = formatArtJobDigest({
      mentionUserId: null,
      today: TODAY,
      items: [
        {
          listing: LISTING,
          resolved: {
            gameTitle: null,
            image: null,
            googleSearchUrl: 'https://www.google.com/search?tbm=isch&q=y',
          },
        },
      ],
    });
    const text = JSON.stringify(blocks);
    expect(text).toContain(
      '🔎 <https://www.google.com/search?tbm=isch&q=y|구글 이미지 검색>',
    );
    expect(text).not.toContain('미리보기');
  });
});

describe('formatArtJobDeadlineReminder', () => {
  it('내일 마감 관심 공고를 링크 목록 한 통으로 묶는다', () => {
    expect(
      formatArtJobDeadlineReminder([
        {
          id: 1,
          company: 'A & B',
          title: '원화 <급구>',
          detailUrl: 'https://www.gamejob.co.kr/x?GI_No=1',
          interestedBy: null,
        },
      ]),
    ).toBe(
      '⏰ 내일 마감인 관심 공고 *1건*\n• <https://www.gamejob.co.kr/x?GI_No=1|원화 급구> · A &amp; B',
    );
  });
});
