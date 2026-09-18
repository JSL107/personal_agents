import { buildSlackSendRecord } from './slack-send-length.recorder';

describe('buildSlackSendRecord', () => {
  const at = new Date('2026-09-18T13:10:03.000Z');

  it('구분선으로 이어 붙인 cron 요약의 조각 수를 센다', () => {
    const merged = ['첫 task 요약', '둘째 task 요약', '셋째 task 요약'].join(
      '\n\n────────\n\n',
    );

    const record = buildSlackSendRecord({ text: merged, origin: 'push', at });

    expect(record.parts).toBe(3);
    expect(record.chars).toBe(merged.length);
  });

  it('구분선이 없는 메시지는 조각 1 로 센다', () => {
    const record = buildSlackSendRecord({
      text: '📊 채택률 이상 없음',
      origin: 'push',
      at,
    });

    expect(record.parts).toBe(1);
  });

  it('머리말은 개행을 공백으로 눕히고 60자에서 자른다', () => {
    const text = `🌙 어제 운영 장애 2건 수습\n\n삭제된 기수를 참조하던 데이터가 원인이었고 ${'긴꼬리'.repeat(20)}`;

    const record = buildSlackSendRecord({ text, origin: 'push-thread', at });

    expect(record.head).toHaveLength(60);
    expect(record.head).not.toContain('\n');
    expect(record.head.startsWith('🌙 어제 운영 장애 2건 수습 삭제된')).toBe(
      true,
    );
  });

  it('발송 경로와 block 수를 그대로 남기고, block 이 없으면 0 으로 센다', () => {
    const card = buildSlackSendRecord({
      text: 'PR #2808 을 코드 리뷰할까요?',
      origin: 'card',
      blocks: 3,
      at,
    });
    const plain = buildSlackSendRecord({
      text: '한 줄 보고',
      origin: 'reply',
      at,
    });

    expect(card).toMatchObject({ origin: 'card', blocks: 3 });
    expect(plain).toMatchObject({ origin: 'reply', blocks: 0 });
    expect(card.at).toBe('2026-09-18T13:10:03.000Z');
  });
});
