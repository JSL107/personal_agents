import { CareerMateException } from '../career-mate.exception';
import { parseCareerMateIntent } from './career-mate-intent.prompt';

describe('parseCareerMateIntent', () => {
  it('BUILD_PROFILE 를 windowMonths 와 함께 파싱한다', () => {
    const intent = parseCareerMateIntent(
      '{"action":"BUILD_PROFILE","windowMonths":6}',
    );
    expect(intent).toEqual({ action: 'BUILD_PROFILE', windowMonths: 6 });
  });

  it('코드펜스로 감싼 JSON 도 파싱한다', () => {
    const intent = parseCareerMateIntent(
      '```json\n{"action":"RENDER_RESUME"}\n```',
    );
    expect(intent.action).toBe('RENDER_RESUME');
  });

  it('RENDER_PORTFOLIO 를 파싱한다', () => {
    expect(parseCareerMateIntent('{"action":"RENDER_PORTFOLIO"}').action).toBe(
      'RENDER_PORTFOLIO',
    );
  });

  it('ANALYZE_JD_GAP 를 파싱한다', () => {
    expect(parseCareerMateIntent('{"action":"ANALYZE_JD_GAP"}').action).toBe(
      'ANALYZE_JD_GAP',
    );
  });

  it('CALIBRATE_RESUME 를 파싱한다', () => {
    expect(parseCareerMateIntent('{"action":"CALIBRATE_RESUME"}').action).toBe(
      'CALIBRATE_RESUME',
    );
  });

  it('알 수 없는 action 은 UNKNOWN 으로 정규화한다', () => {
    expect(parseCareerMateIntent('{"action":"FOO"}').action).toBe('UNKNOWN');
  });

  it('JSON 이 아니면 CareerMateException 을 던진다', () => {
    expect(() => parseCareerMateIntent('헛소리')).toThrow(CareerMateException);
  });
});
