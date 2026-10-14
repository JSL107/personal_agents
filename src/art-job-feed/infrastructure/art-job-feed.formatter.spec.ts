import { ArtJobListing } from '../domain/art-job-feed.type';
import {
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
  it('머리(멘션)와 번호 붙은 공고 목록을 한 통으로 만들고 공고마다 「관심 없음」 버튼을 단다', () => {
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

    expect(message.text).toBe('🎨 <@U9> 게임잡 새 원화 공고 *2건*');
    expect(message.blocks).toEqual([
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '🎨 <@U9> 게임잡 새 원화 공고 *2건*' },
      },
      {
        type: 'section',
        block_id: 'art-job:283904',
        text: {
          type: 'mrkdwn',
          text: [
            '*1. <https://www.gamejob.co.kr/Recruit/GI_Read/View?GI_No=283904|[카오스 제로 나이트메어] 캐릭터 원화 급구  정규직>*',
            '스마일게이트 &amp; 슈퍼크리에이티브 · 경력3년↑ · 정규직 · 경기 성남시 · 🔥 *오늘 마감*',
            '🎮 카오스 제로 나이트메어 · 이미지는 스레드에',
          ].join('\n'),
        },
        accessory: {
          type: 'button',
          action_id: 'art_job_exclude',
          text: { type: 'plain_text', text: '관심 없음' },
          value: '283904',
        },
      },
      {
        type: 'section',
        block_id: 'art-job:2',
        text: {
          type: 'mrkdwn',
          text: [
            '*2. <https://www.gamejob.co.kr/Recruit/GI_Read/View?GI_No=283904|[프로젝트 A] 캐릭터 컨셉>*',
            '그레이게임즈 · 상시',
          ].join('\n'),
        },
        accessory: {
          type: 'button',
          action_id: 'art_job_exclude',
          text: { type: 'plain_text', text: '관심 없음' },
          value: '2',
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '관심 없는 공고는 *관심 없음* 을 눌러 주세요. 같은 공고가 다시 올라와도 보내지 않아요.',
          },
        ],
      },
    ]);
  });

  it('이미지가 없고 게임명이 있으면 게임명을 구글 이미지 검색 링크로 단다', () => {
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
    expect(header).toBe('🎨 게임잡 새 원화 공고 *1건*');
    expect(text).toContain(
      '🎮 <https://www.google.com/search?tbm=isch&q=x|LOST ARK Mobile> (구글 이미지 검색)',
    );
    // 멘션 대상이 없으면 누를 수 있는 사람이 없으므로 버튼도 안내도 싣지 않는다.
    expect(text).not.toContain('accessory');
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
