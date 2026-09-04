import {
  AXIS_APPROVAL,
  AXIS_FAILED_RUN,
  DelayVerdict,
} from '../../agent/delay-report/domain/delay-report.type';
import { formatDelayReport } from './delay-report.formatter';

const verdict = (overrides: Partial<DelayVerdict> = {}): DelayVerdict => ({
  primaryCause: 'NONE',
  detail: '',
  secondaryNotes: [],
  unavailableAxes: [],
  unverifiedHigherPriority: [],
  inconclusiveNotes: [],
  ...overrides,
});

describe('formatDelayReport', () => {
  it('NONE은 지연이 없다는 문장으로 명시적으로 닫는다', () => {
    const text = formatDelayReport(verdict());

    expect(text).toContain('지연 없습니다');
    expect(text).toContain('승인 대기도');
    expect(text).toContain('미해소 실패도 없어요');
  });

  it('원인과 해결 행동을 함께 쓰고 보조 메모는 최대 3줄만 표시한다', () => {
    const text = formatDelayReport(
      verdict({
        primaryCause: 'APPROVAL_WAIT',
        detail: '대표 승인 카드가 12분째 대기 중이에요.',
        secondaryNotes: ['첫 번째', '두 번째', '세 번째', '네 번째'],
      }),
    );

    expect(text).toContain('대표 승인 카드가 12분째');
    expect(text).toContain('승인/거절');
    expect(text).toContain('그 밖에');
    expect(text).not.toContain('네 번째');
  });

  it('확인 불가 축이 있으면 NONE이어도 지연 없다고 단정하지 않는다', () => {
    const text = formatDelayReport(
      verdict({ unavailableAxes: [AXIS_APPROVAL] }),
    );

    expect(text).not.toContain('지연 없습니다');
    expect(text).toContain(AXIS_APPROVAL);
    expect(text).toContain('확인하지 못했어요');
  });

  it('멈춤 의심 작업이 있으면 NONE이어도 지연 없다고 닫지 않는다', () => {
    const text = formatDelayReport(
      verdict({
        secondaryNotes: ['PM 실행이 45분째 멈췄을 가능성이 있어요.'],
        inconclusiveNotes: ['PM 실행이 45분째 멈췄을 가능성이 있어요.'],
      }),
    );

    // 결론과 보조 메모가 서로 어긋나면 안 된다.
    expect(text).not.toContain('지연 없습니다');
    expect(text).toContain('멈춘 것으로 의심');
  });

  it('선택된 원인보다 앞선 축을 못 읽었으면 첫 원인이라고 단정하지 않는다', () => {
    const text = formatDelayReport(
      verdict({
        primaryCause: 'RUN_IN_PROGRESS',
        detail: 'PM이(가) 3분째 작업 중이에요.',
        unavailableAxes: [AXIS_APPROVAL],
        unverifiedHigherPriority: [AXIS_APPROVAL],
      }),
    );

    expect(text).toContain('더 앞선 원인');
    expect(text).toContain('단정하기는 어려워요');
  });

  it('실패 run id를 알면 실행 가능한 재시도 명령을 안내한다', () => {
    const text = formatDelayReport(
      verdict({
        primaryCause: 'UNRESOLVED_FAILURE',
        detail: 'PM 실행이 실패했어요.',
        failureKind: 'OTHER',
        retryRunId: 42,
      }),
    );

    expect(text).toContain('/retry-run 42');
  });

  it('실패 run id를 모르면 실행할 수 없는 명령을 안내하지 않는다', () => {
    const text = formatDelayReport(
      verdict({
        primaryCause: 'UNRESOLVED_FAILURE',
        detail: 'PM 실행이 실패했어요.',
        failureKind: 'OTHER',
        retryRunId: null,
      }),
    );

    expect(text).not.toContain('/retry-run');
  });

  it('일반 실패에는 연동·쿼터 조치를 안내하지 않는다', () => {
    const text = formatDelayReport(
      verdict({
        primaryCause: 'UNRESOLVED_FAILURE',
        detail: 'PM 실행이 실패했어요. 알 수 없는 오류.',
        failureKind: 'OTHER',
        retryRunId: 7,
      }),
    );

    expect(text).not.toContain('.env');
    expect(text).not.toContain('한도');
  });

  it('미연동 실패에는 .env 조치를, 쿼터 실패에는 리셋 안내를 쓴다', () => {
    const integration = formatDelayReport(
      verdict({
        primaryCause: 'UNRESOLVED_FAILURE',
        detail: 'PM 실행이 미연동 상태라 실패했어요.',
        failureKind: 'INTEGRATION',
        retryRunId: 7,
      }),
    );
    const quota = formatDelayReport(
      verdict({
        primaryCause: 'UNRESOLVED_FAILURE',
        detail: 'ChatGPT 사용량 한도 초과로 PM 실행이 실패했어요.',
        failureKind: 'QUOTA',
        retryRunId: 8,
      }),
    );

    expect(integration).toContain('.env');
    expect(quota).toContain('리셋되면');
    expect(quota).not.toContain('.env');
  });

  it('실패 사유가 이미 행동을 말하고 있으면 같은 안내를 두 번 하지 않는다', () => {
    const text = formatDelayReport(
      verdict({
        primaryCause: 'UNRESOLVED_FAILURE',
        detail:
          'ChatGPT 사용량 한도 초과로 PM 실행이 실패했어요. 04:00 KST 에 리셋됩니다. 잠시 후 다시 시도해주세요.',
        failureKind: 'QUOTA',
      }),
    );

    expect(text).toContain('지어내지 않습니다');
    expect(text).not.toContain('자동으로 다시 쓸 수 있습니다');
  });

  it('미해소 실패와 확인 불가 축을 함께 표시한다', () => {
    const text = formatDelayReport(
      verdict({
        primaryCause: 'UNRESOLVED_FAILURE',
        detail: 'PM 실행이 실패했어요.',
        failureKind: 'OTHER',
        unavailableAxes: [AXIS_FAILED_RUN],
      }),
    );

    expect(text).toContain(`다만 ${AXIS_FAILED_RUN}`);
    expect(text).toContain('확인하지 못했어요');
  });

  it('실패 사유의 mrkdwn 제어문자를 escape 해서 내보낸다', () => {
    const text = formatDelayReport(
      verdict({
        primaryCause: 'UNRESOLVED_FAILURE',
        detail: 'PM 실행이 실패했어요. <script> & "a" > b',
        failureKind: 'OTHER',
      }),
    );

    expect(text).toContain('&lt;script&gt;');
    expect(text).toContain('&amp;');
    expect(text).not.toContain('<script>');
  });
});
