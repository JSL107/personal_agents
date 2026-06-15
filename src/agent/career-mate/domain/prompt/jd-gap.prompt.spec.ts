import { CareerMateException } from '../career-mate.exception';
import { CareerProfileData } from '../career-mate.type';
import { buildJdGapPrompt, parseGapAnalysisOutput } from './jd-gap.prompt';

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
  fitSummary: '핵심 요건 부합, 분산처리 강점',
  have: ['NestJS', 'PostgreSQL'],
  gaps: ['Kubernetes', '대규모 트래픽'],
  topics: [
    { title: 'BullMQ 로 분산 큐 안정화한 경험', rationale: '대규모 트래픽 갭' },
    { title: 'K8s 입문 회고', rationale: 'Kubernetes 갭' },
  ],
});

describe('buildJdGapPrompt', () => {
  it('프로필 스킬과 JD 텍스트를 프롬프트에 포함한다', () => {
    const prompt = buildJdGapPrompt(PROFILE, '시니어 백엔드, K8s 필수');
    expect(prompt).toContain('NestJS');
    expect(prompt).toContain('K8s 필수');
  });
});

describe('parseGapAnalysisOutput', () => {
  it('유효 JSON 을 GapAnalysisData 로 파싱한다', () => {
    const data = parseGapAnalysisOutput(VALID);
    expect(data.gaps).toContain('Kubernetes');
    expect(data.topics[0].title).toContain('BullMQ');
  });

  it('코드펜스 제거', () => {
    expect(
      parseGapAnalysisOutput('```json\n' + VALID + '\n```').topics.length,
    ).toBe(2);
  });

  it('topics 가 배열 아니면 INVALID_MODEL_OUTPUT', () => {
    expect(() =>
      parseGapAnalysisOutput(
        '{"fitSummary":"x","have":[],"gaps":[],"topics":"no"}',
      ),
    ).toThrow(CareerMateException);
  });

  it('JSON 아니면 예외', () => {
    expect(() => parseGapAnalysisOutput('nope')).toThrow(CareerMateException);
  });
});
