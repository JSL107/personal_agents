import { isBlogLookup } from './blog-lookup';

describe('isBlogLookup', () => {
  it.each([
    '이거 발행된거야?',
    '정규식 글 발행됐어',
    '남은 초안 뭐 있어',
    '초안 목록 보여줘',
    '블로그 글 몇 개 남았어',
    '그 글 올라갔어?',
  ])('"%s" 는 조회다', (text) => {
    expect(isBlogLookup(text)).toBe(true);
  });

  it.each([
    '노션 초안 발행해줘',
    '블로그 초안 게시해줘',
    '노션 블로그 초안 공유 DB 회고 발행해줘',
    '정규식 글 올려줘',
    '초안 정규식 글 발행해줄래',
  ])('"%s" 는 발행 지시(대조군)다', (text) => {
    expect(isBlogLookup(text)).toBe(false);
  });
});
