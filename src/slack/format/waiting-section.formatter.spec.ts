import { WaitingItem } from '../../github/domain/pr-engagement.type';
import { formatWaitingSection } from './waiting-section.formatter';

describe('formatWaitingSection', () => {
  it('빈 배열 → 빈 문자열', () => {
    expect(formatWaitingSection([])).toBe('');
  });

  it('항목을 사유와 함께 링크로 렌더', () => {
    const items: WaitingItem[] = [
      {
        title: 'PR A',
        url: 'https://github.com/o/r/pull/1',
        reason: '머지만 남음',
      },
    ];
    const out = formatWaitingSection(items);
    expect(out).toContain('대기 중');
    expect(out).toContain('머지만 남음');
    expect(out).toContain('<https://github.com/o/r/pull/1|PR A>');
  });

  it('안전하지 않은 url 은 평문 제목으로 fallback', () => {
    const items: WaitingItem[] = [
      { title: 'PR B', url: 'javascript:alert(1)', reason: 'CI 대기' },
    ];
    const out = formatWaitingSection(items);
    expect(out).toContain('PR B');
    expect(out).not.toContain('javascript:');
  });
});
