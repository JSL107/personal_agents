import { CareerMateException } from '../career-mate.exception';
import {
  buildSynthPrompt,
  parseCareerProfileOutput,
} from './career-profile-synth.prompt';

const VALID = JSON.stringify({
  summary: '백엔드 5년차, 분산 처리 강점',
  skills: [
    {
      name: 'NestJS',
      category: 'FRAMEWORK',
      proficiency: 'EXPERT',
      evidence: [{ repo: 'o/r', pr: 1, url: 'https://x/1' }],
    },
  ],
  accomplishments: [
    {
      title: '큐 락 안정화',
      bullet: 'BullMQ lockDuration 재설계로 stalled 0 달성',
      star: { situation: 's', task: 't', action: 'a', result: 'r' },
      techTags: ['BullMQ'],
      evidence: [
        { repo: 'o/r', pr: 1, url: 'https://x/1', mergedAt: '2026-06-01' },
      ],
    },
  ],
  meta: { githubLogin: 'octo', windowStart: '2025-06-15', prCount: 1 },
});

describe('buildSynthPrompt', () => {
  it('PR 제목과 repo 를 프롬프트에 포함한다', () => {
    const prompt = buildSynthPrompt([
      {
        number: 7,
        title: '큐 락 수정',
        body: 'lockDuration',
        repo: 'o/r',
        url: 'https://x/7',
        state: 'merged',
        mergedAt: '2026-06-01',
        updatedAt: '2026-06-01',
        additions: 10,
        deletions: 2,
        changedFilesCount: 3,
      },
    ]);
    expect(prompt).toContain('큐 락 수정');
    expect(prompt).toContain('o/r#7');
  });
});

describe('parseCareerProfileOutput', () => {
  it('유효한 JSON 을 CareerProfileData 로 파싱한다', () => {
    const data = parseCareerProfileOutput(VALID);
    expect(data.skills[0].name).toBe('NestJS');
    expect(data.accomplishments[0].evidence[0].pr).toBe(1);
  });

  it('코드펜스를 제거하고 파싱한다', () => {
    expect(
      parseCareerProfileOutput('```json\n' + VALID + '\n```').summary,
    ).toContain('백엔드');
  });

  it('skills 가 배열이 아니면 INVALID_MODEL_OUTPUT 예외', () => {
    expect(() =>
      parseCareerProfileOutput(
        '{"summary":"x","skills":"no","accomplishments":[],"meta":{}}',
      ),
    ).toThrow(CareerMateException);
  });

  it('JSON 이 아니면 예외', () => {
    expect(() => parseCareerProfileOutput('not json')).toThrow(
      CareerMateException,
    );
  });
});
