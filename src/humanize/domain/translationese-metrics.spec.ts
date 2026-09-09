import { measureTranslationese } from './translationese-metrics';

describe('measureTranslationese', () => {
  describe('이중 피동', () => {
    // 상류(`metrics_v2.py`)를 그대로 옮기면 부분문자열이 겹치는 사전 항목 때문에 한 자리를
    // 여러 번 센다(실측: "보여진다" 1건 → 4). 이 세 케이스가 그 회귀를 막는다.
    it.each([
      ['결과가 보여진다.', 1],
      ['그렇게 판단되어진다.', 1],
      ['이제는 잊혀진다.', 1],
      ['보여진다. 그리고 또 보여진다.', 2],
    ])('%s → %i회', (markdown, expected) => {
      expect(measureTranslationese(markdown).doublePassiveCount).toBe(expected);
    });

    // 이 레포가 재려는 글은 해요체다. 표면형 사전을 그대로 옮기면 여기서 전부 0 이 나온다.
    it.each([
      ['결과가 보여져요.', 1],
      ['결과가 보여집니다.', 1],
      ['그렇게 판단되어져요.', 1],
      ['결과가 보여졌다.', 1],
      ['결과가 보여졌어요.', 1],
      ['그렇게 판단되어졌습니다.', 1],
      ['언젠가 보여질 것이다.', 1],
    ])(
      '해요체·합쇼체·과거형 활용도 잡는다 — %s → %i회',
      (markdown, expected) => {
        expect(measureTranslationese(markdown).doublePassiveCount).toBe(
          expected,
        );
      },
    );

    it('단일 피동은 자연스러운 표현이라 세지 않는다', () => {
      expect(
        measureTranslationese('그렇게 판단된다. 결과가 보인다.')
          .doublePassiveCount,
      ).toBe(0);
    });

    // 상류는 범용 `여진` 을 사전에 둬서 이 둘을 이중 피동으로 센다.
    it.each(['여진이 계속됐다.', '제안이 받아들여진다.'])(
      '이중 피동이 아닌 것은 세지 않는다 — %s',
      (markdown) => {
        expect(measureTranslationese(markdown).doublePassiveCount).toBe(0);
      },
    );
  });

  describe('에 의해', () => {
    // 상류는 뒤에 오는 피동 서술어를 AND 조건으로 걸어 이 넷 중 셋을 놓쳤다. 어간이 어미와
    // 한 음절로 합쳐지기 때문이다(되+ㄴ → 된).
    it.each([
      ['AI에 의해 생성된다.', 1],
      ['정책에 의해 결정된 사항이다.', 1],
      ['시장에 의해 좌우된다.', 1],
      ['AI에 의해 생성되었다.', 1],
      ['법에 의하여 정해진다.', 1],
    ])('%s → %i회', (markdown, expected) => {
      expect(measureTranslationese(markdown).byAgentPhraseCount).toBe(expected);
    });

    it('마커가 없으면 세지 않는다', () => {
      expect(
        measureTranslationese('AI가 결과를 만든다.').byAgentPhraseCount,
      ).toBe(0);
    });
  });

  describe('직역 경동사', () => {
    it.each([
      ['회의를 가지다.', 1],
      ['경쟁력을 가지고 있다.', 1],
      ['경쟁력을 가지고 있어요.', 1],
      ['많이 갖고 있습니다.', 1],
    ])('%s → %i회', (markdown, expected) => {
      expect(measureTranslationese(markdown).literalLightVerbCount).toBe(
        expected,
      );
    });

    it('환원된 표현은 세지 않는다', () => {
      expect(
        measureTranslationese('경쟁력이 강하다. 회의를 했다.')
          .literalLightVerbCount,
      ).toBe(0);
    });

    // 상류 사전에는 있지만 뺐다 — 그 자체로 자연스러운 한국어라 정상 문장을 대량으로 끌어온다.
    it.each(['결정을 내렸다.', '제품을 만들었다.', '책을 가지런히 놓았다.'])(
      '자연스러운 한국어는 세지 않는다 — %s',
      (markdown) => {
        expect(measureTranslationese(markdown).literalLightVerbCount).toBe(0);
      },
    );
  });

  describe('무생물 주어', () => {
    it('무생물 주어와 보편 서술어가 함께 있는 문장만 센다', () => {
      const metrics = measureTranslationese(
        '데이터는 그 사실을 보여준다. 나는 어제 밥을 먹었다.',
      );

      expect(metrics.inanimateSubjectPercent).toBe(50);
    });

    it('무생물 주어라도 보편 서술어가 없으면 세지 않는다', () => {
      expect(
        measureTranslationese('데이터는 어제 들어왔다.')
          .inanimateSubjectPercent,
      ).toBe(0);
    });

    it('관형사가 앞서도 주어를 찾는다 — 프롬프트가 예시로 든 「본 작업은…」 형태', () => {
      const metrics = measureTranslationese(
        '본 분석은 새로운 사실을 보여준다.',
      );

      expect(metrics.inanimateSubjectPercent).toBe(100);
      expect(metrics.samples).toContain('분석은');
    });

    // 굵게 표식·인용부호가 붙으면 어절이 `**데이터는**` 이 되어 어떤 사전에도 걸리지 않는다.
    it.each([
      '**데이터는** 그 사실을 보여준다.',
      '\u201c데이터는 그 사실을 보여준다.\u201d',
    ])('장식 문자가 붙어도 주어를 찾는다 — %s', (markdown) => {
      expect(measureTranslationese(markdown).inanimateSubjectPercent).toBe(100);
    });

    it('서술어가 해요체여도 찾는다', () => {
      expect(
        measureTranslationese('데이터는 그 사실을 보여줘요.')
          .inanimateSubjectPercent,
      ).toBe(100);
    });

    // `-원` 은 사람 쪽이 훨씬 흔한데 `보여주다`·`말해주다` 가 보편 서술어에 있어 AND 조건도
    // 이 오탐을 못 거른다. 그래서 접미사 목록에서 뺐다.
    it.each(['직원은 결과를 보여줬어요.', '연구원은 의미를 말해줬어요.'])(
      '사람을 가리키는 `-원` 주어는 세지 않는다 — %s',
      (markdown) => {
        expect(measureTranslationese(markdown).inanimateSubjectPercent).toBe(0);
      },
    );

    it('사람 주어에 보편 서술어가 붙은 문장은 세지 않는다', () => {
      expect(
        measureTranslationese('철수는 그 사실을 보여준다.')
          .inanimateSubjectPercent,
      ).toBe(0);
    });
  });

  describe('표본', () => {
    it('코드 블록 안의 문장은 재지 않는다', () => {
      const markdown = [
        '```ts',
        'const a = 1; // 결과가 보여진다.',
        '```',
        '',
        '본문은 멀쩡하다.',
      ].join('\n');

      expect(measureTranslationese(markdown).doublePassiveCount).toBe(0);
    });

    it('산문이 없으면 전부 0 이다', () => {
      const metrics = measureTranslationese('');

      expect(metrics).toEqual({
        doublePassiveCount: 0,
        byAgentPhraseCount: 0,
        literalLightVerbCount: 0,
        inanimateSubjectPercent: 0,
        samples: [],
      });
    });

    it('무엇이 잡혔는지 표면형을 함께 낸다 — 개수만으로는 오탐을 가릴 수 없다', () => {
      const metrics = measureTranslationese(
        '결과가 보여진다. AI에 의해 생성된다.',
      );

      expect(metrics.samples).toContain('보여진');
      expect(metrics.samples).toContain('에 의해');
    });

    it('축을 번갈아 뽑아 비어 있지 않은 축은 모두 표본을 낸다', () => {
      const metrics = measureTranslationese(
        '보여진다. 되어진다. 잊혀진다. 닫혀진다. 열려진다. AI에 의해 만든다. 경쟁력을 가지고 있다.',
      );

      // 앞 축부터 이어 붙이면 이중 피동 다섯 개가 자리를 다 먹는다.
      expect(metrics.samples).toContain('에 의해');
      expect(metrics.samples).toContain('가지고 있');
    });

    it('표면형은 중복을 걷고 다섯 개까지만 낸다', () => {
      const markdown = [
        '결과가 보여진다.',
        '그렇게 판단되어진다.',
        '이제는 잊혀진다.',
        '문이 닫혀진다.',
        '창이 열려진다.',
        '이름이 불려진다.',
        '짐이 놓여진다.',
      ].join(' ');

      expect(measureTranslationese(markdown).samples).toHaveLength(5);
    });
  });
});
