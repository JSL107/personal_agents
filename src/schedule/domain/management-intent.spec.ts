import {
  hasManagementMarker,
  matchesManagementAction,
  parseManagementIntent,
} from './management-intent';
import { ManagementAction } from './management-intent.type';

describe('management intent', () => {
  it.each([
    '결제 API 진행 중으로',
    '로그 확인 끝났어',
    '결제 API 내일 3시에 알려줘',
    '결제 API 끝나면 PM한테 공유해야 해',
    '결제 API에 메모 남겨줘',
  ])('관리 동사 표지를 식별한다: %s', (text) => {
    expect(hasManagementMarker(text)).toBe(true);
  });
  it.each(['9월 30일 자동차세', '내일 오후 일정 알려줘'])(
    '조회·등록 문장에는 관리 표지가 없다: %s',
    (text) => {
      expect(hasManagementMarker(text)).toBe(false);
    },
  );
  it('모델의 다른 동작은 사용자 발화와 불일치하므로 쓰지 않는다', () => {
    expect(
      matchesManagementAction({
        text: '결제 API 내일 3시에 알려줘',
        intent: {
          action: ManagementAction.STATUS,
          titleQuery: '결제 API',
          status: 'DONE' as never,
        },
      }),
    ).toBe(false);
    expect(
      matchesManagementAction({
        text: '결제 API 내일 3시에 알려줘',
        intent: {
          action: ManagementAction.REMIND,
          titleQuery: '결제 API',
          remindAt: new Date('2099-01-01T06:00:00Z'),
        },
      }),
    ).toBe(true);
    expect(
      matchesManagementAction({
        text: '결제 API 진행 중으로',
        intent: {
          action: ManagementAction.STATUS,
          titleQuery: '결제 API',
          status: 'DONE' as never,
        },
      }),
    ).toBe(false);
  });
  it('필드 누락·과거 시각·길이 초과 모델 출력을 거부한다', () => {
    expect(
      parseManagementIntent({ action: 'REMIND', titleQuery: '결제 API' }),
    ).toBeNull();
    expect(
      parseManagementIntent({
        action: 'REMIND',
        titleQuery: '결제 API',
        remindAt: '2020-01-01T00:00:00+09:00',
      }),
    ).toBeNull();
    expect(
      parseManagementIntent({
        action: 'NOTE',
        titleQuery: '결제 API',
        note: 'x'.repeat(501),
      }),
    ).toBeNull();
  });
  it('200자 업무 제목은 허용하고 201자는 거부한다', () => {
    expect(
      parseManagementIntent({
        action: 'NOTE',
        titleQuery: '가'.repeat(200),
        note: '확인',
      }),
    ).toMatchObject({ titleQuery: '가'.repeat(200) });
    expect(
      parseManagementIntent({
        action: 'NOTE',
        titleQuery: '가'.repeat(201),
        note: '확인',
      }),
    ).toBeNull();
  });
  it.each([
    '2099-02-30T15:00:00+09:00',
    '2099-11-05T15:00+09:00junk',
    '2099-13-01T15:00:00+09:00',
  ])('잘못된 ISO 날짜를 거절한다: %s', (remindAt) => {
    expect(
      parseManagementIntent({
        action: 'REMIND',
        titleQuery: '결제 API',
        remindAt,
      }),
    ).toBeNull();
  });
});

it('초가 생략된 오프셋 ISO 시각도 알림으로 받아들인다', () => {
  expect(
    parseManagementIntent({
      action: 'REMIND',
      titleQuery: '결제 API',
      remindAt: '2099-11-05T15:00+09:00',
    }),
  ).toMatchObject({
    action: ManagementAction.REMIND,
    remindAt: new Date('2099-11-05T06:00:00Z'),
  });
});
