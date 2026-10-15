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
      { kind: 'NEEDS_TERMS', action: 'ADD', listKind: undefined },
    ],
    ['공고 가져와', { kind: 'FETCH' }],
    ['공고 올려줘', { kind: 'FETCH' }],
    ['공고 보내줘', { kind: 'FETCH' }],
    ['지금 공고', { kind: 'FETCH' }],
    ['새 공고 있어? 올려줘', { kind: 'FETCH' }],
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
});
