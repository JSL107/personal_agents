import { JobApplicationException } from '../job-application.exception';
import { parseJobApplicationIntent } from './job-application-parse.prompt';

describe('parseJobApplicationIntent', () => {
  it('ADD 파싱 (회사/직무/마감)', () => {
    const intent = parseJobApplicationIntent(
      '{"action":"ADD","company":"토스","role":"백엔드","deadline":"2026-06-30"}',
    );
    expect(intent.action).toBe('ADD');
    expect(intent.company).toBe('토스');
    expect(intent.deadline).toEqual({ year: 2026, month: 6, day: 30 });
  });

  it('UPDATE_STATUS 파싱 (ref+status)', () => {
    const intent = parseJobApplicationIntent(
      '{"action":"UPDATE_STATUS","ref":"토스","status":"SCREENING"}',
    );
    expect(intent).toMatchObject({
      action: 'UPDATE_STATUS',
      ref: '토스',
      status: 'SCREENING',
    });
  });

  it('LIST 파싱', () => {
    expect(parseJobApplicationIntent('{"action":"LIST"}').action).toBe('LIST');
  });

  it('잘못된 status 는 INVALID_STATUS 예외', () => {
    expect(() =>
      parseJobApplicationIntent(
        '{"action":"UPDATE_STATUS","ref":"토스","status":"WUT"}',
      ),
    ).toThrow(JobApplicationException);
  });

  it('JSON 아니면 NL_PARSE_FAILED', () => {
    expect(() => parseJobApplicationIntent('헛소리')).toThrow(
      JobApplicationException,
    );
  });

  it('알 수 없는 action → UNKNOWN', () => {
    expect(parseJobApplicationIntent('{"action":"FOO"}').action).toBe(
      'UNKNOWN',
    );
  });
});
