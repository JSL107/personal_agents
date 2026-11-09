import {
  FirstLineType,
  ReelExperimentArm,
  TitleForm,
} from './instagram-insight.type';
import { extractReelFeatures } from './reel-features';

const line = (patch: Record<string, string> = {}) => ({
  subtitle: '백악관 네트워크에도 남의 트래픽 흔적',
  speech: '가나다라',
  gesture: 'idle',
  react: 'none',
  point_kind: 'none',
  point: '',
  ...patch,
});

// 2026-11-04 ai 폴더 script.json 의 형태(최상위 script 키).
const legacyScript = {
  duration: 39.618,
  engine: 'voice clone bright-2 tempo 1.02',
  row: { title: 'AI 에이전트 안전성' },
  script: {
    headline: '시험 땐 경고를 덜 따라요',
    subject: 'Codex',
    lines: [
      line({ subtitle: '시험에선 경고를 덜 따랐대요', gesture: 'wave' }),
      line({ gesture: 'point', point_kind: 'point', react: 'surprise' }),
      line({ gesture: 'think' }),
    ],
  },
};

// 하루 1편 script.json 의 형태(hermes-skill-reels.py 의 segments).
const dailyScript = {
  title: '이제 평가를 의심해요 · 버그를 먼저 찾아 줘요',
  duration: 52,
  cover_offset_ms: 49750,
  engine: 'voice clone skill-reels-voice tempo 1.00',
  segments: [
    {
      field: 'ai',
      segment: {
        headline: '이제 평가를 의심해요',
        lines: [
          line({ subtitle: '구성도 그리다 로고 찾다 지친 적 있죠?' }),
          line({ point_kind: 'number' }),
        ],
      },
    },
    {
      field: 'dev',
      segment: {
        headline: '버그를 먼저 찾아 줘요',
        lines: [line({ react: 'thumbsup' }), line(), line()],
      },
    },
  ],
};

describe('extractReelFeatures', () => {
  it('구형 한 편 script.json 을 읽는다', () => {
    const features = extractReelFeatures({
      script: legacyScript,
      folderField: 'ai',
    });
    expect(features).toEqual({
      version: 1,
      durationSec: 39.618,
      segmentFields: ['ai'],
      headlines: ['시험 땐 경고를 덜 따라요'],
      titleForm: TitleForm.STATEMENT,
      firstLine: {
        subtitle: '시험에선 경고를 덜 따랐대요',
        speech: '가나다라',
        gesture: 'wave',
        react: 'none',
      },
      firstLineType: FirstLineType.STATEMENT,
      lineCount: 3,
      speechChars: 12,
      pointCards: 1,
      reacts: ['surprise'],
      gestureCounts: { wave: 1, point: 1, think: 1 },
      engine: 'voice clone bright-2 tempo 1.02',
    });
  });

  it('하루 1편 script.json 은 꼭지를 합쳐 세고 첫 꼭지로 첫 줄·제목을 본다', () => {
    const features = extractReelFeatures({
      script: dailyScript,
      folderField: 'daily',
    });
    expect(features).toMatchObject({
      durationSec: 52,
      segmentFields: ['ai', 'dev'],
      headlines: ['이제 평가를 의심해요', '버그를 먼저 찾아 줘요'],
      firstLineType: FirstLineType.QUESTION,
      lineCount: 5,
      pointCards: 1,
      reacts: ['thumbsup'],
      gestureCounts: { idle: 5 },
    });
  });

  it('script.json 의 형식 실험 기록을 옮기고, 모양이 틀리면 빼고 나머지는 남긴다', () => {
    const experiment = {
      policyVersion: 3,
      source: 'file',
      experimentId: 'exp-1',
      knob: 'early_card',
      arm: ReelExperimentArm.CHALLENGER,
      values: { early_card: true },
      realized: true,
      checks: { firstCardSec: 1.2 },
    };
    expect(
      extractReelFeatures({
        script: { ...dailyScript, experiment },
        folderField: 'daily',
      })?.experiment,
    ).toEqual(experiment);
    const broken = extractReelFeatures({
      script: { ...dailyScript, experiment: { ...experiment, arm: 'x' } },
      folderField: 'daily',
    });
    expect(broken).not.toBeNull();
    expect(broken).not.toHaveProperty('experiment');
  });

  it.each([
    ['구성도 그리다 로고 찾다 지친 적 있죠?', FirstLineType.QUESTION],
    ['시험 성공률이 10.2~37.4%p 낮아요', FirstLineType.NUMBER],
    ['백악관 네트워크에도 남의 트래픽 흔적', FirstLineType.STATEMENT],
    ['2개 중 뭘 쓸까요?', FirstLineType.QUESTION],
  ])('첫 줄 %s → %s', (subtitle, expected) => {
    const script = {
      ...legacyScript,
      script: { ...legacyScript.script, lines: [line({ subtitle })] },
    };
    expect(
      extractReelFeatures({ script, folderField: 'ai' })?.firstLineType,
    ).toBe(expected);
  });

  it.each([
    ['이제 비교할 수 있어요', TitleForm.RESULT],
    ['버그를 먼저 찾아 줘요', TitleForm.RESULT],
    ['이거 써도 될까?', TitleForm.QUESTION],
    ['업데이트 안 하면 위험해요', TitleForm.STATEMENT],
  ])('제목 %s → %s', (headline, expected) => {
    const script = {
      ...legacyScript,
      script: { ...legacyScript.script, headline },
    };
    expect(extractReelFeatures({ script, folderField: 'ai' })?.titleForm).toBe(
      expected,
    );
  });

  it.each([
    ['빈 객체', {}],
    ['줄 없음', { ...legacyScript, script: { headline: 'h', lines: [] } }],
    ['길이 없음', { ...legacyScript, duration: undefined }],
    ['문자열', 'x'],
  ])('형식이 다르면(%s) null', (_, script) => {
    expect(extractReelFeatures({ script, folderField: 'ai' })).toBeNull();
  });
});
