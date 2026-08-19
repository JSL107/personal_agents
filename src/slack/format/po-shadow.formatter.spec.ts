import { PoShadowReport } from '../../agent/po-shadow/domain/po-shadow.type';
import { formatPoShadowReport } from './po-shadow.formatter';

const base: PoShadowReport = {
  priorityRecheck: '성과 정리보다 #264 업로드 차단 검증이 먼저다.',
  missingRequirements: ['#264 업로드 차단 — 회귀 테스트가 없다'],
  releaseRisks: ['#975 인증 쿠키 — 정상 흐름까지 막힐 수 있다'],
  realPurposeQuestion: '오늘의 목적은 성과 정리인가 안전 확인인가?',
  recommendation: '#264 업로드 차단 회귀부터 검증한다.',
};

describe('formatPoShadowReport', () => {
  it('결론(권고)이 제목 바로 다음에 온다', () => {
    const lines = formatPoShadowReport(base).split('\n\n');
    expect(lines[0]).toBe('*PO Shadow 검토*');
    expect(lines[1]).toContain('먼저 이것부터');
    expect(lines[1]).toContain('#264 업로드 차단 회귀부터 검증한다.');
  });

  it('되묻기는 맨 마지막에 온다', () => {
    const sections = formatPoShadowReport(base).split('\n\n');
    expect(sections[sections.length - 1]).toContain(
      '오늘의 목적은 성과 정리인가 안전 확인인가?',
    );
  });

  it('빈 필드는 라벨만 남은 줄로 새지 않는다', () => {
    const rendered = formatPoShadowReport({
      ...base,
      recommendation: '   ',
      realPurposeQuestion: '',
      missingRequirements: [],
      releaseRisks: [],
    });
    expect(rendered).not.toContain('먼저 이것부터');
    expect(rendered).not.toContain('❓');
    expect(rendered).not.toContain('빠진 것');
    expect(rendered).toContain('순서 점검');
  });

  it('LLM 자유텍스트의 제어문자를 escape 한다', () => {
    const rendered = formatPoShadowReport({
      ...base,
      recommendation: '<script> & </script>',
    });
    expect(rendered).toContain('&lt;script&gt; &amp; &lt;/script&gt;');
  });
});
