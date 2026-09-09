import {
  isContentDropped,
  measureChangeRate,
  measureLengthRetention,
} from './change-rate';

describe('measureChangeRate', () => {
  it('같은 글은 0 이다', () => {
    expect(measureChangeRate('같은 글이다.', '같은 글이다.')).toBe(0);
  });

  it('공백만 다시 흘려 담은 것은 변경으로 보지 않는다', () => {
    expect(
      measureChangeRate('한 줄로 쓴 글이다.', '한 줄로\n  쓴   글이다.'),
    ).toBe(0);
  });

  it('둘 다 비면 0 이다', () => {
    expect(measureChangeRate('', '')).toBe(0);
  });

  it('한쪽만 비면 전면 교체로 본다', () => {
    expect(measureChangeRate('원문이 있다.', '')).toBe(1);
  });

  it('한 글자짜리는 바이그램이 없어 같고 다름만 가른다', () => {
    expect(measureChangeRate('가', '가')).toBe(0);
    expect(measureChangeRate('가', '나')).toBe(1);
  });

  // 값의 크기 감각을 고정한다. 임계값은 이 눈금 위에서 정해진다.
  it('어미만 바꾼 것 < 정상 윤문 < 전혀 다른 글 순으로 커진다', () => {
    const endingOnly = measureChangeRate(
      '어제 배포를 마쳤습니다.',
      '어제 배포를 마쳤어요.',
    );
    const rewritten = measureChangeRate(
      '본 작업은 성능의 향상을 위한 것이다.',
      '이번 작업은 성능을 끌어올리려고 했어요.',
    );
    const unrelated = measureChangeRate(
      '어제 배포를 마쳤습니다.',
      '고양이가 담장 위를 걷는다.',
    );

    expect(endingOnly).toBeLessThan(rewritten);
    expect(rewritten).toBeLessThan(unrelated);
    // 정상 윤문이 이미 0.5 를 넘는다 — 상류의 「0.50 초과는 강제 중단」 임계를 그대로
    // 옮기면 멀쩡한 윤문이 전부 롤백된다. 이 단언이 그 착각을 막는다.
    expect(rewritten).toBeGreaterThan(0.5);
  });

  it('길이가 0 에서 1 사이로 갇힌다', () => {
    const rate = measureChangeRate(
      '아주 긴 원문을 여기에 둔다. 문장이 여러 개다.',
      '완전히 다른 내용으로 채운 글. 겹치는 말이 없다.',
    );

    expect(rate).toBeGreaterThanOrEqual(0);
    expect(rate).toBeLessThanOrEqual(1);
  });
});

describe('NFC 정규화', () => {
  // macOS 파일·클립보드를 거치면 자모 분해형(NFD)이 섞여 들어온다. 맞춰 주지 않으면
  // 어미만 바꾼 글이 전면 교체(1.0)로 잡힌다.
  it('자모 분해형과 조합형을 같은 글자로 본다', () => {
    const composed = '오늘은 배포를 마치고 확인했습니다.';

    expect(measureChangeRate(composed.normalize('NFD'), composed)).toBe(0);
  });
});

describe('변경률은 판정에 쓸 수 없다', () => {
  // 이 단언이 「임계 하나 놓으면 되지 않나」를 막는다. 두 무리가 겹친다.
  it('정상 간결화와 완전히 무관한 글의 변경률이 갈리지 않는다', () => {
    const concise = measureChangeRate(
      '현재 시점에서는 해당 기능을 사용하는 것이 불가능한 상태입니다.',
      '지금은 이 기능을 쓸 수 없어요.',
    );
    const unrelated = measureChangeRate(
      '재고 문서가 틀린 자리가 둘 있었고, 둘 다 범위를 넘겨 읽은 탓이었습니다.',
      '고양이가 담장 위를 천천히 걸어갔고, 해는 이미 기울어 있었어요.',
    );

    expect(Math.abs(concise - unrelated)).toBeLessThan(0.05);
  });
});

describe('measureLengthRetention', () => {
  it('절반으로 줄면 0.5 다', () => {
    expect(measureLengthRetention('12345678', '1234')).toBe(0.5);
  });

  it('원문이 비면 1 로 둔다 — 나눌 것이 없다', () => {
    expect(measureLengthRetention('', '무언가')).toBe(1);
  });
});

describe('isContentDropped', () => {
  const verbose =
    '현재 시점에서는 해당 기능을 사용하는 것이 불가능한 상태입니다.';

  // codex 리뷰가 반례로 낸 쌍이다. 길이 유지율 0.53 이라 통과해야 한다.
  it('정상 간결화는 되돌리지 않는다', () => {
    expect(isContentDropped(verbose, '지금은 이 기능을 쓸 수 없어요.')).toBe(
      false,
    );
  });

  it('내용을 통째로 날린 출력은 되돌린다', () => {
    expect(isContentDropped(verbose, '불가.')).toBe(true);
  });

  it('짧은 필드는 판정하지 않는다', () => {
    expect(isContentDropped('배포 완료', '끝')).toBe(false);
  });

  it('길이가 비슷하면 내용이 달라도 잡지 못한다 — 이 가드의 한계', () => {
    expect(
      isContentDropped(
        '재고 문서가 틀린 자리가 둘 있었고, 둘 다 범위를 넘겨 읽은 탓이었습니다.',
        '고양이가 담장 위를 천천히 걸어갔고, 해는 이미 기울어 있었어요.',
      ),
    ).toBe(false);
  });
});
