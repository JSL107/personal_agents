import {
  extractActionMessageRef,
  extractInputValue,
} from './action-body.parser';

describe('extractInputValue — 빈 입력도 유효한 값', () => {
  const bodyWith = (value: unknown) => ({ actions: [{ value }] });

  it('타이핑한 문자열을 그대로 돌려준다', () => {
    expect(extractInputValue(bodyWith('결제 실패율 3%→0.5%'))).toBe(
      '결제 실패율 3%→0.5%',
    );
  });

  it('칸을 비우면 Slack 이 null 을 보낸다 — 지움도 입력이라 빈 문자열로 받는다', () => {
    expect(extractInputValue(bodyWith(null))).toBe('');
    expect(extractInputValue(bodyWith(undefined))).toBe('');
  });

  it('actions 가 없으면 null (해석 실패)', () => {
    expect(extractInputValue({})).toBeNull();
    expect(extractInputValue(null)).toBeNull();
    expect(extractInputValue({ actions: [] })).toBeNull();
  });
});

describe('extractActionMessageRef — 이벤트가 난 카드 좌표', () => {
  it('container 의 channel_id / message_ts 를 우선한다', () => {
    expect(
      extractActionMessageRef({
        container: { channel_id: 'C1', message_ts: '111.222' },
        channel: { id: 'C-other' },
        message: { ts: '999.999' },
      }),
    ).toEqual({ channel: 'C1', ts: '111.222' });
  });

  it('container 가 없으면 channel.id / message.ts 로 떨어진다', () => {
    expect(
      extractActionMessageRef({
        channel: { id: 'C2' },
        message: { ts: '333' },
      }),
    ).toEqual({ channel: 'C2', ts: '333' });
  });

  it('좌표를 못 읽으면 null — 저장은 끝났으므로 그리기만 건너뛴다', () => {
    expect(extractActionMessageRef(null)).toBeNull();
    expect(extractActionMessageRef({})).toBeNull();
    expect(extractActionMessageRef({ channel: { id: 'C3' } })).toBeNull();
    expect(extractActionMessageRef({ message: { ts: '444' } })).toBeNull();
  });
});
