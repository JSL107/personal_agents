import {
  CodexQuotaExceededException,
  CodexReadLockException,
  CodexTimeoutException,
} from '../../../model-router/infrastructure/codex-cli.provider';
import { RepoReadFallbackReason } from '../domain/code-reviewer.type';
import { classifyRepoReadFailure } from './repo-read-fallback';

describe('classifyRepoReadFailure', () => {
  it('래핑 없는 타임아웃은 TIMEOUT', () => {
    expect(classifyRepoReadFailure(new CodexTimeoutException(300_000))).toBe(
      RepoReadFallbackReason.TIMEOUT,
    );
  });

  // 라우터 wrapCompletionFailed 의 래핑 모양 — cause: { primaryError, lastError }.
  it('라우터가 감싼 읽기 잠금 실패는 READ_LOCK', () => {
    const wrapped = Object.assign(new Error('route failed'), {
      cause: { primaryError: new CodexReadLockException('canary 읽힘') },
    });
    expect(classifyRepoReadFailure(wrapped)).toBe(
      RepoReadFallbackReason.READ_LOCK,
    );
  });

  it('라우터가 감싼 쿼터 소진은 QUOTA', () => {
    const wrapped = Object.assign(new Error('route failed'), {
      cause: { lastError: new CodexQuotaExceededException('10:00') },
    });
    expect(classifyRepoReadFailure(wrapped)).toBe(RepoReadFallbackReason.QUOTA);
  });

  it('알 수 없는 오류는 OTHER', () => {
    expect(classifyRepoReadFailure(new Error('boom'))).toBe(
      RepoReadFallbackReason.OTHER,
    );
  });

  it('쿼터와 타임아웃이 함께 있으면 QUOTA 가 앞선다', () => {
    const wrapped = Object.assign(new Error('route failed'), {
      cause: {
        primaryError: new CodexTimeoutException(300_000),
        lastError: new CodexQuotaExceededException(),
      },
    });
    expect(classifyRepoReadFailure(wrapped)).toBe(RepoReadFallbackReason.QUOTA);
  });
});
