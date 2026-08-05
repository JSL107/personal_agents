import { parseStudyResearch } from './study-research.parser';

describe('parseStudyResearch', () => {
  it.each([
    ['CONCEPT', 'LangGraph 체크포인터'],
    ['TOOL', 'context7 MCP'],
  ])('정상 %s 조사 결과를 파싱한다', (kind, topic) => {
    const result = parseStudyResearch(
      `KIND: ${kind}\nTOPIC: ${topic}\nSOURCES: https://a.example/doc, https://b.example/post\n---\n깊이 있는 조사 본문`,
    );

    expect(result).toEqual({
      kind,
      topic,
      sourceUrls: ['https://a.example/doc', 'https://b.example/post'],
      reportMd: '깊이 있는 조사 본문',
    });
  });

  it('SOURCES가 없으면 빈 배열을 반환한다', () => {
    const result = parseStudyResearch(
      'KIND: CONCEPT\nTOPIC: durable execution\n---\n본문',
    );

    expect(result).toMatchObject({ sourceUrls: [] });
  });

  it('Hermes 진행 로그를 버리고 첫 KIND 줄부터 파싱한다', () => {
    const result = parseStudyResearch(
      '[progress] searching web\n[progress] reading docs\nKIND: TOOL\nTOPIC: LangSmith\n---\n본문',
    );

    expect(result).toMatchObject({ kind: 'TOOL', topic: 'LangSmith' });
  });

  it('앞뒤 코드펜스를 벗긴다', () => {
    const result = parseStudyResearch(
      '```text\nKIND: CONCEPT\nTOPIC: ReAct\n---\n본문\n```',
    );

    expect(result).toMatchObject({ topic: 'ReAct', reportMd: '본문' });
  });

  it('NO_TOPIC 사유를 정상 건너뜀 결과로 반환한다', () => {
    expect(parseStudyResearch('NO_TOPIC: 최근 주제와 모두 중복됨')).toEqual({
      skippedReason: '최근 주제와 모두 중복됨',
    });
  });

  it.each([
    ['NO_TOPIC:   ', 'NO_TOPIC 사유'],
    ['KIND: MAYBE\nTOPIC: x\n---\n본문', 'KIND'],
    ['KIND: CONCEPT\n---\n본문', 'TOPIC'],
    ['KIND: CONCEPT\nTOPIC: x\n본문', '구분선'],
    ['KIND: CONCEPT\nTOPIC: x\n---\n   ', '본문'],
  ])('잘못된 출력은 원인을 담아 거부한다: %s', (raw, reason) => {
    expect(() => parseStudyResearch(raw)).toThrow(reason);
  });

  it('KIND나 NO_TOPIC 시작점이 없으면 원인을 담아 거부한다', () => {
    expect(() => parseStudyResearch('Hermes progress only')).toThrow(
      'KIND 또는 NO_TOPIC',
    );
  });
});
