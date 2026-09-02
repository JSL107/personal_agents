import { liftLegacyHeadings } from './legacy-heading';

describe('liftLegacyHeadings', () => {
  it('### 만 있는 옛 초안은 한 단계 올린다', () => {
    // 2026-09-02 발행본이 이 모양이었다 — 소제목 7개가 전부 `### ` 라 큰 제목이 없었다.
    const legacy = [
      '### 첫 절',
      '본문이에요.',
      '### 둘째 절',
      '본문이에요.',
    ].join('\n');

    expect(liftLegacyHeadings(legacy)).toBe(
      ['## 첫 절', '본문이에요.', '## 둘째 절', '본문이에요.'].join('\n'),
    );
  });

  it('두 층을 제대로 쓴 글은 건드리지 않는다', () => {
    const proper = [
      '## 큰 절',
      '본문이에요.',
      '### 작은 절',
      '본문이에요.',
    ].join('\n');

    expect(liftLegacyHeadings(proper)).toBe(proper);
  });

  it('### 이 없으면 그대로 둔다', () => {
    const flat = ['## 절 하나', '본문이에요.'].join('\n');

    expect(liftLegacyHeadings(flat)).toBe(flat);
  });

  it('코드블록 안의 주석은 헤딩으로 보지 않는다', () => {
    // 셸 예시의 `### 구분선` 을 올리면 코드가 깨진다.
    const withCode = [
      '### 설정하기',
      '```bash',
      '### 여기부터 실행',
      'pnpm test',
      '```',
      '본문이에요.',
    ].join('\n');

    const lifted = liftLegacyHeadings(withCode);

    expect(lifted).toContain('## 설정하기');
    expect(lifted).toContain('### 여기부터 실행');
  });

  it('코드블록 안에만 ## 가 있으면 옛 초안 판정을 방해하지 않는다', () => {
    // 펜스 안의 `## ` 를 본문 헤딩으로 세면 옛 초안이 보정되지 않고 그대로 나간다.
    const tricky = [
      '### 진짜 소제목',
      '```bash',
      '## 이건 주석이에요',
      '```',
    ].join('\n');

    expect(liftLegacyHeadings(tricky)).toContain('## 진짜 소제목');
  });
});
