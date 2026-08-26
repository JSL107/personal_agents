import {
  buildReadableBlocks,
  toReadableMessage,
} from './message-blocks.builder';

describe('buildReadableBlocks', () => {
  it('제목만 있는 줄을 header 로 올리고 그 앞에 divider 를 깐다', () => {
    const blocks = buildReadableBlocks(
      [
        '*판단 근거*: 어제 미완료를 앞으로 당겼다',
        '',
        '*오전*',
        '• 첫 과제',
      ].join('\n'),
    );

    expect(blocks?.map((block) => block.type)).toEqual([
      'section',
      'divider',
      'header',
      'section',
    ]);
    expect(blocks?.[2]).toEqual({
      type: 'header',
      text: { type: 'plain_text', text: '오전', emoji: true },
    });
  });

  it('본문이 뒤따르는 `*라벨*: 값` 줄은 제목으로 올리지 않는다', () => {
    const blocks = buildReadableBlocks(
      ['*오전*', '• 과제', '*예상 소요*: 6시간'].join('\n'),
    );

    const headers = blocks?.filter((block) => block.type === 'header');
    expect(headers).toHaveLength(1);
    expect(blocks?.[blocks.length - 1]).toEqual({
      type: 'section',
      text: { type: 'mrkdwn', text: '• 과제\n*예상 소요*: 6시간' },
    });
  });

  it('제목이 없으면 블록으로 감싸지 않고 text 경로에 맡긴다', () => {
    expect(buildReadableBlocks('그냥 한 줄짜리 안내입니다.')).toBeNull();
    expect(buildReadableBlocks('   ')).toBeNull();
  });

  it('블록 상한 50 을 넘기면 null 로 되돌려 text 발송을 유지한다', () => {
    const many = Array.from({ length: 40 }, (_, i) => `*제목 ${i}*\n본문`).join(
      '\n',
    );

    expect(buildReadableBlocks(many)).toBeNull();
  });
});

describe('toReadableMessage', () => {
  it('맨 GitHub 주소를 이름으로 접고 blocks 와 text 를 함께 낸다', () => {
    const result = toReadableMessage(
      [
        '*판단 근거*: PR (https://github.com/schoolbell-e/sbe-api-v5/pull/52) 를 최우선으로 뒀다',
        '',
        '*오전*',
        '• 과제',
      ].join('\n'),
    );

    expect(result.text).toContain(
      '(<https://github.com/schoolbell-e/sbe-api-v5/pull/52|sbe-api-v5 #52>)',
    );
    expect(result.text).not.toContain('(https://github.com');
    expect(result.blocks).toBeDefined();
  });

  it('이미 `<url|이름>` 으로 감싼 링크는 건드리지 않는다', () => {
    const source = '• <https://github.com/o/r/pull/1|오래된 PR> (5일째)';

    expect(toReadableMessage(source).text).toBe(source);
  });
});

describe('buildReadableBlocks — header 안전장치', () => {
  it('제목 줄에 링크나 이스케이프 문자가 섞이면 승격하지 않는다', () => {
    const blocks = buildReadableBlocks(
      [
        '*<https://github.com/o/r/pull/1|PR 1>*',
        '본문',
        '*a &lt;b&gt; c*',
        '*정상 제목*',
      ].join('\n'),
    );

    const headers = blocks
      ?.filter((block) => block.type === 'header')
      .map((block) => (block.text as { text: string }).text);
    expect(headers).toEqual(['정상 제목']);
  });
});

describe('buildReadableBlocks — 코드블록 보호', () => {
  const withFence = [
    '*제안 모델 / 변경*',
    '```prisma',
    'model User {',
    '  // 굵게 보이는 줄이 코드 안에 있어도 제목이 아니다',
    '*단독 강조 줄*',
    '}',
    '```',
    '*리스크*',
    '• 없음',
  ].join('\n');

  it('코드블록 안의 `*강조*` 줄은 제목으로 올리지 않는다', () => {
    const headers = buildReadableBlocks(withFence)
      ?.filter((block) => block.type === 'header')
      .map((block) => (block.text as { text: string }).text);

    expect(headers).toEqual(['제안 모델 / 변경', '리스크']);
  });

  it('코드블록이 한 section 안에서 열고 닫힌다', () => {
    const sections = buildReadableBlocks(withFence)
      ?.filter((block) => block.type === 'section')
      .map((block) => (block.text as { text: string }).text);
    const fenced = sections?.filter((text) => text.includes('```')) ?? [];

    expect(fenced).toHaveLength(1);
    // 여는 fence 와 닫는 fence 가 같은 조각 안에 있어야 렌더가 안 깨진다.
    expect(fenced[0].match(/```/g)).toHaveLength(2);
  });
});
