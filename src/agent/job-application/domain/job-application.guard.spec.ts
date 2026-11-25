import { isApplicationStatus, isWebUrl } from './job-application.guard';
import { APPLICATION_STATUSES } from './job-application.type';

describe('job-application.guard', () => {
  it('등록된 모든 지원 상태를 허용하고 그 밖의 값은 거절한다', () => {
    for (const status of APPLICATION_STATUSES) {
      expect(isApplicationStatus(status)).toBe(true);
    }
    expect(isApplicationStatus('UNKNOWN')).toBe(false);
    expect(isApplicationStatus(null)).toBe(false);
  });

  it('http 와 https URL 만 허용하고 원본 문자열의 공백은 검증에만 사용한다', () => {
    expect(isWebUrl('https://example.com/jobs')).toBe(true);
    expect(isWebUrl('http://example.com/jobs')).toBe(true);
    expect(isWebUrl(' https://example.com/jobs ')).toBe(true);
    expect(isWebUrl('ftp://example.com/jobs')).toBe(false);
    expect(isWebUrl(' \t ')).toBe(false);
    expect(isWebUrl('invalid')).toBe(false);
    expect(isWebUrl(null)).toBe(false);
  });
});
