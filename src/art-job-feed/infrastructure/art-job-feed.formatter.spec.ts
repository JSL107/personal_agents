import { ArtJobListing } from '../domain/art-job-feed.type';
import {
  formatArtJobHeader,
  formatArtJobPosting,
} from './art-job-feed.formatter';

const LISTING: ArtJobListing = {
  sourceId: '283904',
  company: '스마일게이트 & 슈퍼크리에이티브',
  title: '[카오스 제로 나이트메어] 캐릭터 원화 <급구> | 정규직',
  detailUrl: 'https://www.gamejob.co.kr/Recruit/GI_Read/View?GI_No=283904',
  deadlineText: '채용시',
};

describe('formatArtJobHeader', () => {
  it('멘션 대상이 있으면 머리에 멘션을 붙인다', () => {
    expect(formatArtJobHeader({ count: 3, mentionUserId: 'U9' })).toBe(
      '🎨 <@U9> 게임잡 새 원화 공고 *3건*',
    );
  });

  it('멘션 대상이 없으면 멘션 없이 보낸다', () => {
    expect(formatArtJobHeader({ count: 1, mentionUserId: null })).toBe(
      '🎨 게임잡 새 원화 공고 *1건*',
    );
  });
});

describe('formatArtJobPosting', () => {
  it('링크 안 제목에서 링크를 깨는 문자를 지우고 & 는 이스케이프한다', () => {
    const text = formatArtJobPosting(LISTING, {
      gameTitle: '카오스 제로 나이트메어',
      image: { url: 'https://play-lh.example/x=w512', origin: 'PLAY_STORE' },
      googleSearchUrl: null,
    });
    expect(text.split('\n')[0]).toBe(
      '*<https://www.gamejob.co.kr/Recruit/GI_Read/View?GI_No=283904|[카오스 제로 나이트메어] 캐릭터 원화 급구  정규직>*',
    );
    expect(text).toContain(
      '🏢 스마일게이트 &amp; 슈퍼크리에이티브 · ⏰ 채용시',
    );
    expect(text).toContain('🎮 카오스 제로 나이트메어');
    expect(text).not.toContain('구글 이미지 검색');
  });

  it('이미지가 없을 때만 구글 이미지 검색 링크를 단다', () => {
    const text = formatArtJobPosting(
      { ...LISTING, deadlineText: null },
      {
        gameTitle: null,
        image: null,
        googleSearchUrl: 'https://www.google.com/search?tbm=isch&q=x',
      },
    );
    expect(text).toContain(
      '🔎 <https://www.google.com/search?tbm=isch&q=x|구글 이미지 검색>',
    );
    expect(text).not.toContain('⏰');
    expect(text).not.toContain('🎮');
  });
});
