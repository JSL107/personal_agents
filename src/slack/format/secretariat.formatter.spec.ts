import { SecretariatDigest } from '../../autopilot/domain/secretariat.digest';
import { formatSecretariat } from './secretariat.formatter';

const NOW = new Date('2026-08-03T00:00:00.000Z');

const digestOf = (
  overrides: Partial<SecretariatDigest>,
): SecretariatDigest => ({
  completed: [],
  inProgress: [],
  approvals: [],
  blocked: [],
  decision: null,
  ...overrides,
});

const render = (overrides: Partial<SecretariatDigest>): string =>
  formatSecretariat(digestOf(overrides), '2026-08-03', NOW);

describe('formatSecretariat', () => {
  it('비어 있으면 다섯 항목 모두 "없음" 으로 낸다', () => {
    const text = render({});

    expect(text).toContain('*① 완료* — 없음');
    expect(text).toContain('*② 진행 중* — 없음');
    expect(text).toContain('*③ 대표 승인 대기* — 없음');
    expect(text).toContain('*④ 막힌 것* — 없음');
    expect(text).toContain('*⑤ 오늘 결정할 것* — 없음');
  });

  describe('① 완료 축약', () => {
    it('총 건수를 앞세우고 5종까지 인라인으로 나열한다', () => {
      const text = render({
        completed: [
          { agentType: 'PM', count: 7 },
          { agentType: 'CEO', count: 2 },
        ],
      });

      expect(text).toContain('*① 완료* — 9건 · PM 7 · CEO 2');
    });

    it('5종을 넘으면 나머지를 "외 N종" 으로 접는다', () => {
      // 실측에서 하루 13종이 나와 한 줄이 화면을 넘었다.
      const completed = Array.from({ length: 8 }, (_, index) => ({
        agentType: `AGENT_${index}`,
        count: 1,
      }));

      const text = render({ completed });

      expect(text).toContain('*① 완료* — 8건 ·');
      expect(text).toContain('외 3종');
    });
  });

  describe('③ 승인 대기 · ④ 막힌 것 목록', () => {
    it('3건까지 상세를 펴고 나머지는 "외 N건" 으로 접는다', () => {
      const approvals = Array.from({ length: 5 }, (_, index) => ({
        label: `카드 ${index}`,
        expiresAt: new Date(NOW.getTime() + 3600_000),
      }));

      const text = render({ approvals });

      expect(text).toContain('*③ 대표 승인 대기* — 5건');
      expect(text).toContain('• 카드 0 —');
      expect(text).toContain('• 카드 2 —');
      expect(text).not.toContain('• 카드 3 —');
      expect(text).toContain('외 2건');
    });

    it('남은 시간을 분·시간 단위로 바꾸고 지난 것은 "곧 만료" 로 쓴다', () => {
      const text = render({
        approvals: [
          { label: 'A', expiresAt: new Date(NOW.getTime() + 30 * 60_000) },
          { label: 'B', expiresAt: new Date(NOW.getTime() + 5 * 3600_000) },
          { label: 'C', expiresAt: new Date(NOW.getTime() - 60_000) },
        ],
      });

      expect(text).toContain('• A — 30분 뒤 만료');
      expect(text).toContain('• B — 5시간 뒤 만료');
      expect(text).toContain('• C — 곧 만료');
    });
  });

  describe('Slack mrkdwn escape', () => {
    it('실패 이유의 제어문자를 escape 한다', () => {
      // LLM·CLI 가 낸 자유 텍스트에 <...> 가 섞이면 Slack 이 링크 태그로 오인해 문장이 잘린다.
      const text = render({
        blocked: [
          { agentType: 'PM', reason: '<script> & 파싱 실패', count: 1 },
        ],
      });

      expect(text).toContain('&lt;script&gt; &amp; 파싱 실패');
      expect(text).not.toContain('<script>');
    });

    it('승인 카드 제목도 escape 한다', () => {
      const text = render({
        approvals: [
          {
            label: '<b>제목</b>',
            expiresAt: new Date(NOW.getTime() + 3600_000),
          },
        ],
      });

      expect(text).toContain('&lt;b&gt;제목&lt;/b&gt;');
    });
  });

  describe('⑤ 결정 문구', () => {
    it('승인 카드는 남은 시간과 함께 낸다', () => {
      const text = render({
        decision: {
          kind: 'APPROVAL',
          label: '블로그 발행',
          expiresAt: new Date(NOW.getTime() + 3 * 3600_000),
        },
      });

      expect(text).toContain(
        '*⑤ 오늘 결정할 것* — 블로그 발행 승인 (3시간 뒤 만료)',
      );
    });

    it('미복구 실패는 "연속" 이라고 쓰지 않는다', () => {
      // 관측 창 안의 실패 건수일 뿐 사이에 성공이 있었는지는 이 숫자로 알 수 없다.
      const text = render({
        decision: {
          kind: 'UNRESOLVED_FAILURE',
          agentType: 'PM',
          reason: '모델 호출 실패',
          count: 3,
        },
      });

      expect(text).toContain('PM 3건 실패, 아직 복구 안 됨 — 모델 호출 실패');
      expect(text).not.toContain('연속');
    });
  });
});
