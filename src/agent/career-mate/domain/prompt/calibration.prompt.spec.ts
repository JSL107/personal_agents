import { CareerMateException } from '../career-mate.exception';
import { CareerProfileData } from '../career-mate.type';
import {
  buildCalibrationPrompt,
  parseCalibrationOutput,
} from './calibration.prompt';

const PROFILE: CareerProfileData = {
  summary: '백엔드 5년차',
  skills: [
    {
      name: 'NestJS',
      category: 'FRAMEWORK',
      proficiency: 'EXPERT',
      evidence: [{ repo: 'o/r', pr: 1, url: 'https://x/1' }],
    },
  ],
  accomplishments: [],
  meta: { githubLogin: 'octo', windowStart: '2025-06-15', prCount: 1 },
};

const VALID = JSON.stringify({
  verdict: '전반적으로 견고하나 정량 지표 보강 필요',
  aiSlopRisks: ['"다양한 업무 수행" 같은 모호한 표현'],
  underQuantified: ['성과에 수치 없음'],
  outdatedPhrasing: ['"열정적인" 류 진부 표현'],
  missingKeywords: ['관측가능성', 'IaC'],
  actionItems: ['각 성과에 정량 지표 추가'],
});

describe('buildCalibrationPrompt', () => {
  it('프로필 스킬을 프롬프트에 포함한다', () => {
    expect(buildCalibrationPrompt(PROFILE, undefined)).toContain('NestJS');
  });
  it('webTrendsNote 가 있으면 프롬프트에 포함한다', () => {
    const prompt = buildCalibrationPrompt(
      PROFILE,
      '2026 트렌드: AI 협업 경험 강조',
    );
    expect(prompt).toContain('2026 트렌드');
  });
  it('webTrendsNote 가 없으면 트렌드 섹션을 넣지 않는다', () => {
    expect(buildCalibrationPrompt(PROFILE, undefined)).not.toContain(
      '[최신 시장 트렌드]',
    );
  });
});

describe('parseCalibrationOutput', () => {
  it('유효 JSON 을 CalibrationResultData 로 파싱한다', () => {
    const data = parseCalibrationOutput(VALID);
    expect(data.verdict).toContain('견고');
    expect(data.missingKeywords).toContain('IaC');
  });
  it('코드펜스 제거', () => {
    expect(
      parseCalibrationOutput('```json\n' + VALID + '\n```').actionItems.length,
    ).toBe(1);
  });
  it('배열 필드가 배열 아니면 INVALID_MODEL_OUTPUT', () => {
    expect(() =>
      parseCalibrationOutput(
        '{"verdict":"x","aiSlopRisks":"no","underQuantified":[],"outdatedPhrasing":[],"missingKeywords":[],"actionItems":[]}',
      ),
    ).toThrow(CareerMateException);
  });
  it('JSON 아니면 예외', () => {
    expect(() => parseCalibrationOutput('nope')).toThrow(CareerMateException);
  });
});
