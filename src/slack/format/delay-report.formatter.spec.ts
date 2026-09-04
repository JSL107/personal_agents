import { DelayVerdict } from '../../agent/delay-report/domain/delay-report.type';
import { formatDelayReport } from './delay-report.formatter';

describe('formatDelayReport', () => {
  it('NONE은 지연이 없다는 문장으로 명시적으로 닫는다', () => {
    const text = formatDelayReport({
      primaryCause: 'NONE',
      detail: '',
      secondaryNotes: [],
      unavailableAxes: [],
    });

    expect(text).toContain('지연 없습니다');
    expect(text).toContain('승인 대기도');
    expect(text).toContain('미해소 실패도 없어요');
  });

  it('원인과 해결 행동을 함께 쓰고 보조 메모는 최대 3줄만 표시한다', () => {
    const verdict: DelayVerdict = {
      primaryCause: 'APPROVAL_WAIT',
      detail: '대표 승인 카드가 12분째 대기 중이에요.',
      secondaryNotes: ['첫 번째', '두 번째', '세 번째', '네 번째'],
      unavailableAxes: [],
    };

    const text = formatDelayReport(verdict);

    expect(text).toContain('대표 승인 카드가 12분째');
    expect(text).toContain('승인/거절');
    expect(text).toContain('그 밖에');
    expect(text).not.toContain('네 번째');
  });

  it('확인 불가 축이 있으면 NONE이어도 지연 없다고 단정하지 않는다', () => {
    const text = formatDelayReport({
      primaryCause: 'NONE',
      detail: '',
      secondaryNotes: [],
      unavailableAxes: ['승인 대기 카드'],
    });

    expect(text).not.toContain('지연 없습니다');
    expect(text).toContain('승인 대기 카드');
    expect(text).toContain('확인하지 못했어요');
  });

  it('미해소 실패와 확인 불가 축을 함께 표시한다', () => {
    const text = formatDelayReport({
      primaryCause: 'UNRESOLVED_FAILURE',
      detail: 'PM 실행이 실패했어요.',
      secondaryNotes: [],
      unavailableAxes: ['최근 실패'],
    });

    expect(text).toContain('다만 최근 실패는 확인하지 못했어요');
  });
});
