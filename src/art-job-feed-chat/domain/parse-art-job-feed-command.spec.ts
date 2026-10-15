import {
  mergeArtJobFeedCommands,
  parseArtJobFeedCommand,
} from './parse-art-job-feed-command';

describe('parseArtJobFeedCommand', () => {
  it.each([
    [
      '[캐주얼 / 북미풍] 키워드도 찾아줬으면 좋겠어!',
      { kind: 'NEEDS_LIST', action: 'ADD', terms: ['캐주얼', '북미풍'] },
    ],
    [
      '공고 [일러스트/ 디자이너/ 아트 / 원화 / 캐릭터] 키워드도 추가해줘',
      {
        kind: 'NEEDS_LIST',
        action: 'ADD',
        terms: ['일러스트', '디자이너', '아트', '원화', '캐릭터'],
      },
    ],
    [
      '디자이너 공고에서 해당 키워드를 함께 조사할수 있어?',
      { kind: 'UNKNOWN' },
    ],
    [
      '그거랑 더불어서 캐주얼 북미풍도 함께 넣어서 찾아서 나한테 지금 보여줘봐.',
      // 「지금 보여줘」가 중심이라 가져오기로 읽는다 — 키워드는 바꾸지 않는다.
      { kind: 'FETCH', terms: [] },
    ],
    // #849 리뷰 — 인용 안의 「스타일」은 목록 이름이 아니다.
    [
      '허용에 "북미 스타일" 추가해줘',
      { kind: 'ADD', listKind: 'TARGET', terms: ['북미 스타일'] },
    ],
    [
      '제외어에 "UI 스타일" 넣어줘',
      { kind: 'ADD', listKind: 'EXCLUDED', terms: ['UI 스타일'] },
    ],
    // #849 리뷰 — 목록 이름 뒤의 실제 키워드를 뽑는다.
    [
      '허용 키워드에 2D 추가해줘',
      { kind: 'ADD', listKind: 'TARGET', terms: ['2D'] },
    ],
    [
      '제외 키워드에서 3D 제거해줘',
      { kind: 'REMOVE', listKind: 'EXCLUDED', terms: ['3D'] },
    ],
    ['공고 가져와', { kind: 'FETCH', terms: [] }],
    // 2026-10-15 16:19 — 「공고」 없이 말한 가져오기.
    ['지금줘봐', { kind: 'FETCH', terms: [] }],
    ['공고가져와', { kind: 'FETCH', terms: [] }],
    [
      '[캐주얼 / 북미풍 / 일러스트/ 디자이너/ 아트 / 원화 / 캐릭터] 관련 공고 찾아줘.',
      {
        kind: 'FETCH',
        terms: [
          '캐주얼',
          '북미풍',
          '일러스트',
          '디자이너',
          '아트',
          '원화',
          '캐릭터',
        ],
      },
    ],
    // run 9099 — 동사 없이 키워드와 목록만 말하면 추가.
    [
      "'반실사' 키워드 제외(제목에 있으면 거르기)",
      { kind: 'ADD', listKind: 'EXCLUDED', terms: ['반실사'] },
    ],
    [
      '반실사 키워드 제외',
      { kind: 'ADD', listKind: 'EXCLUDED', terms: ['반실사'] },
    ],
    ['공고 올려줘', { kind: 'FETCH', terms: [] }],
    ['공고 보내줘', { kind: 'FETCH', terms: [] }],
    ['지금 공고', { kind: 'FETCH', terms: [] }],
    ['새 공고 있어? 올려줘', { kind: 'FETCH', terms: [] }],
    ['원화 공고 키워드 보여줘', { kind: 'LIST', listKind: undefined }],
    ['화풍 키워드 목록', { kind: 'LIST', listKind: 'STYLE' }],
    ['허용 키워드 알려줘', { kind: 'LIST', listKind: 'TARGET' }],
    ['제외 목록 확인', { kind: 'LIST', listKind: 'EXCLUDED' }],
    [
      '화풍에 북미풍 추가해줘',
      { kind: 'ADD', listKind: 'STYLE', terms: ['북미풍'] },
    ],
    [
      '허용에 "캐릭터" 추가해줘',
      { kind: 'ADD', listKind: 'TARGET', terms: ['캐릭터'] },
    ],
    [
      '제외 키워드에 「UI」 넣어줘',
      { kind: 'ADD', listKind: 'EXCLUDED', terms: ['UI'] },
    ],
    [
      '캐주얼 키워드 제거해줘',
      { kind: 'NEEDS_LIST', action: 'REMOVE', terms: ['캐주얼'] },
    ],
    [
      '화풍에 "북미풍" 빼줘',
      { kind: 'REMOVE', listKind: 'STYLE', terms: ['북미풍'] },
    ],
    ['제외해줘', { kind: 'NEEDS_TERMS', action: 'ADD', listKind: undefined }],
    ['3D 제외해줘', { kind: 'NEEDS_LIST', action: 'ADD', terms: ['3D'] }],
    [
      '북미풍 추가해줘',
      { kind: 'NEEDS_LIST', action: 'ADD', terms: ['북미풍'] },
    ],
    [
      '화풍에 추가해줘',
      { kind: 'NEEDS_TERMS', action: 'ADD', listKind: 'STYLE' },
    ],
    [
      '공고 "캐주얼, 북미풍" 키워드를 추가해줘',
      { kind: 'NEEDS_LIST', action: 'ADD', terms: ['캐주얼', '북미풍'] },
    ],
  ])('%s', (text, expected) => {
    expect(parseArtJobFeedCommand(text as string)).toEqual(expected);
  });

  it('비정상 키워드를 버린다', () => {
    expect(
      parseArtJobFeedCommand(
        '허용에 "<@U123>, 안전, 아주아주아주아주아주아주아주아주아주긴키워드" 추가해줘',
      ),
    ).toEqual({ kind: 'ADD', listKind: 'TARGET', terms: ['안전'] });
  });

  it('직전 모호한 요청과 목록 후속 답을 합친다', () => {
    const prior = parseArtJobFeedCommand(
      '[캐주얼 / 북미풍] 키워드도 찾아줬으면 좋겠어!',
    );
    expect(
      mergeArtJobFeedCommands(prior, parseArtJobFeedCommand('화풍'), '화풍'),
    ).toEqual({ kind: 'ADD', listKind: 'STYLE', terms: ['캐주얼', '북미풍'] });
  });

  it.each(['제외', '제외에 추가해줘', '제외로 해줘'])(
    '목록 되묻기에 %s 라고 답하면 제외 목록에 추가한다',
    (answer) => {
      const prior = parseArtJobFeedCommand('3D 제외해줘');
      expect(
        mergeArtJobFeedCommands(prior, parseArtJobFeedCommand(answer), answer),
      ).toEqual({ kind: 'ADD', listKind: 'EXCLUDED', terms: ['3D'] });
    },
  );

  it('직전 키워드 되묻기와 단어 답을 합친다', () => {
    const prior = parseArtJobFeedCommand('화풍에 추가해줘');
    expect(
      mergeArtJobFeedCommands(
        prior,
        parseArtJobFeedCommand('북미풍'),
        '북미풍',
      ),
    ).toEqual({ kind: 'ADD', listKind: 'STYLE', terms: ['북미풍'] });
  });

  // 2026-10-15 16:05 실제 대화 — 봇이 보여 준 라벨을 「」로 감싸 답했다.
  describe('run 9099 회귀', () => {
    const prior = parseArtJobFeedCommand(
      '[캐주얼 / 북미풍 / 일러스트/ 디자이너/ 아트 / 원화 / 캐릭터] 키워드도 추가해줘',
    );
    const labelAnswer =
      '「허용(제목에 있으면 받기) / 화풍(태그만)/ 화풍에 추가」';

    it('라벨을 키워드로 뽑지 않는다', () => {
      expect(parseArtJobFeedCommand(labelAnswer)).not.toMatchObject({
        terms: expect.arrayContaining(['화풍(태그만)']),
      });
    });

    it('목록을 둘 고른 답이면 직전 키워드로 다시 묻는다', () => {
      expect(
        mergeArtJobFeedCommands(
          prior,
          parseArtJobFeedCommand(labelAnswer),
          labelAnswer,
        ),
      ).toEqual({
        kind: 'NEEDS_LIST',
        action: 'ADD',
        terms: [
          '캐주얼',
          '북미풍',
          '일러스트',
          '디자이너',
          '아트',
          '원화',
          '캐릭터',
        ],
      });
    });

    it.each(['스타일', '「스타일」'])(
      '되묻기에 %s 라고 답하면 화풍에 넣는다',
      (answer) => {
        expect(
          mergeArtJobFeedCommands(
            prior,
            parseArtJobFeedCommand(answer),
            answer,
          ),
        ).toMatchObject({ kind: 'ADD', listKind: 'STYLE' });
      },
    );

    it('괄호가 든 정상 키워드는 받는다', () => {
      expect(parseArtJobFeedCommand('허용에 "C++(언리얼)" 추가해줘')).toEqual({
        kind: 'ADD',
        listKind: 'TARGET',
        terms: ['C++(언리얼)'],
      });
    });

    it('라벨 하나만 「」로 답하면 그 목록에 넣는다', () => {
      const answer = '「화풍(태그만)」';
      expect(
        mergeArtJobFeedCommands(prior, parseArtJobFeedCommand(answer), answer),
      ).toMatchObject({ kind: 'ADD', listKind: 'STYLE' });
    });

    it('자기 키워드가 있는 다음 말은 직전 키워드와 합치지 않는다', () => {
      const text = "'반실사' 키워드 제외(제목에 있으면 거르기)";
      expect(
        mergeArtJobFeedCommands(
          parseArtJobFeedCommand(labelAnswer),
          parseArtJobFeedCommand(text),
          text,
        ),
      ).toEqual({ kind: 'ADD', listKind: 'EXCLUDED', terms: ['반실사'] });
      expect(
        mergeArtJobFeedCommands(prior, parseArtJobFeedCommand(text), text),
      ).toEqual({ kind: 'ADD', listKind: 'EXCLUDED', terms: ['반실사'] });
    });
  });
});
