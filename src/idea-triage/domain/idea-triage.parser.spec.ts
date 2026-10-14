import { IdeaTriageException } from './idea-triage.exception';
import { parseIdeaTriageOutput } from './idea-triage.parser';
import { validateIdeaTriageOutput } from './idea-triage.validator';

const VALID_OUTPUT = {
  verdict: 'BUILD',
  reason: '반복 작업을 줄인다. 사용자가 분명하다.',
  counterpoint: '현재 수요가 입증되지 않았다.',
  scheduleTitle: '슬랙 아이디어를 분류한다',
  effort: 'M',
};

describe('idea triage parser and validator', () => {
  it('JSON 코드 펜스를 해제하고 유효한 판정을 받는다', () => {
    const parsed = parseIdeaTriageOutput(
      `\`\`\`json\n${JSON.stringify(VALID_OUTPUT)}\n\`\`\``,
    );
    expect(validateIdeaTriageOutput(parsed)).toEqual(VALID_OUTPUT);
  });

  it('허용되지 않은 판정과 규모를 거부한다', () => {
    expect(() =>
      validateIdeaTriageOutput({ ...VALID_OUTPUT, verdict: 'MAYBE' }),
    ).toThrow(IdeaTriageException);
    expect(() =>
      validateIdeaTriageOutput({ ...VALID_OUTPUT, effort: 'XL' }),
    ).toThrow(IdeaTriageException);
  });

  it('제목을 trim 하고 40자로 자른다', () => {
    const result = validateIdeaTriageOutput({
      ...VALID_OUTPUT,
      scheduleTitle: `  ${'가'.repeat(41)}  `,
    });
    expect(result.scheduleTitle).toBe('가'.repeat(40));
  });

  it('JSON 이 아니면 도메인 예외를 던진다', () => {
    expect(() => parseIdeaTriageOutput('아무 글')).toThrow(IdeaTriageException);
  });
});
