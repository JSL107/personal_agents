import { CareerMateException } from '../career-mate.exception';
import { CareerProfileData, CareerTargetJdData } from '../career-mate.type';
import {
  buildResumeAuditPrompt,
  parseResumeAuditOutput,
} from './resume-audit.prompt';

const PROFILE: CareerProfileData = {
  summary: '백엔드 시스템을 안정화했다.',
  skills: [
    {
      name: 'NestJS',
      category: 'FRAMEWORK',
      proficiency: 'EXPERT',
      evidence: [{ repo: 'owner/api', pr: 10, url: 'https://example.com/10' }],
    },
  ],
  accomplishments: [
    {
      title: '장애율 감소',
      bullet: '재시도 정책으로 장애율을 30% 줄였다.',
      star: {
        situation: '간헐적 외부 API 장애가 있었다.',
        task: '실패 전파를 줄여야 했다.',
        action: '지수 백오프를 적용했다.',
        result: '장애율을 30% 줄였다.',
      },
      techTags: ['NestJS', 'BullMQ'],
      evidence: [
        {
          repo: 'owner/api',
          pr: 10,
          url: 'https://example.com/10',
          mergedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
    },
  ],
  meta: { githubLogin: 'octo', windowStart: '2026-01-01', prCount: 1 },
};

const TARGET_JD: CareerTargetJdData = {
  id: 1,
  company: '이대리',
  role: '백엔드 엔지니어',
  jdText: 'NestJS 운영 경험 필수',
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
};

const VALID_OUTPUT = JSON.stringify({
  verdict: '증거가 확인된다.',
  items: [
    {
      title: '장애율 감소',
      status: 'PROVEN',
      quote: '장애율을 30% 줄였다.',
      why: '정량 결과가 있다.',
      rewrite: null,
    },
  ],
  jdFindings: [
    {
      requirement: 'NestJS 운영 경험',
      priority: 'MUST',
      status: 'PROVEN',
      quote: 'NestJS',
      why: '스킬과 성과에 있다.',
    },
  ],
  rejectionRisks: [{ reason: '규모 정보 부족', rebuttal: null }],
});

describe('buildResumeAuditPrompt', () => {
  it('성과 원문과 근거 PR 및 목표 공고를 그대로 포함한다', () => {
    const prompt = buildResumeAuditPrompt(PROFILE, TARGET_JD);

    expect(prompt).toContain('### 장애율 감소');
    expect(prompt).toContain('상황: 간헐적 외부 API 장애가 있었다.');
    expect(prompt).toContain('근거: owner/api#10');
    expect(prompt).toContain('[목표 공고] 이대리 / 백엔드 엔지니어');
    expect(prompt).toContain('NestJS 운영 경험 필수');
  });

  it('목표 공고가 없으면 공고 섹션을 넣지 않는다', () => {
    expect(buildResumeAuditPrompt(PROFILE, null)).not.toContain('[목표 공고]');
  });
});

describe('parseResumeAuditOutput', () => {
  it('모델이 rewrite 키를 생략한 항목을 받아 null 로 채운다', () => {
    // 실측: PROVEN 항목에서 모델은 rewrite 키를 아예 쓰지 않는다(25건 중 11건).
    // 이걸 거부하면 항목 하나 때문에 감사 전체가 파싱 실패로 죽는다.
    const output = JSON.stringify({
      verdict: '보강이 필요하다.',
      items: [
        {
          title: '배포 안정화',
          status: 'PROVEN',
          quote: '결과: 실패율 4%→0.5%',
          why: '정량 결과가 있다.',
        },
      ],
      jdFindings: [],
      rejectionRisks: [],
    });

    const parsed = parseResumeAuditOutput(output);

    expect(parsed.items[0].rewrite).toBeNull();
  });

  it('정상 JSON의 모든 배열을 파싱한다', () => {
    const data = parseResumeAuditOutput(VALID_OUTPUT);

    expect(data.items[0].status).toBe('PROVEN');
    expect(data.jdFindings[0].priority).toBe('MUST');
    expect(data.rejectionRisks[0].rebuttal).toBeNull();
  });

  it('코드펜스로 감싼 JSON을 파싱한다', () => {
    const data = parseResumeAuditOutput(`\`\`\`json\n${VALID_OUTPUT}\n\`\`\``);

    expect(data.verdict).toBe('증거가 확인된다.');
  });

  it('status 오탈자를 거부한다', () => {
    const malformed = VALID_OUTPUT.replace('PROVEN', 'PROVE');

    expect(() => parseResumeAuditOutput(malformed)).toThrow(
      CareerMateException,
    );
  });

  it('rewrite 필드 형태가 잘못되면 거부한다', () => {
    const malformed = JSON.stringify({
      ...JSON.parse(VALID_OUTPUT),
      items: [
        {
          title: '장애율 감소',
          status: 'WEAK',
          quote: '',
          why: '수치가 없다.',
          rewrite: { before: '기존', after: '개선', frame: 'STAR5' },
        },
      ],
    });

    expect(() => parseResumeAuditOutput(malformed)).toThrow(
      CareerMateException,
    );
  });

  it('rejectionRisks.rebuttal null을 허용한다', () => {
    expect(parseResumeAuditOutput(VALID_OUTPUT).rejectionRisks[0]).toEqual({
      reason: '규모 정보 부족',
      rebuttal: null,
    });
  });
});
