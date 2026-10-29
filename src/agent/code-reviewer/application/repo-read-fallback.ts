import { findInModelErrorChain } from '../../../model-router/application/extract-codex-quota';
import {
  CodexQuotaExceededException,
  CodexReadLockException,
  CodexTimeoutException,
} from '../../../model-router/infrastructure/codex-cli.provider';
import { RepoReadFallbackReason } from '../domain/code-reviewer.type';

const hasInChain = (
  error: unknown,
  type: abstract new (...args: never[]) => Error,
): boolean =>
  findInModelErrorChain(
    error,
    (value): value is Error => value instanceof type,
  ) !== null;

// 검사 순서가 우선순위다. 쿼터가 가장 앞인 이유는 후퇴 재실행이 claude 로 바로 넘어가는 원인이라서다 —
// 같은 체인에 타임아웃이 섞여 있어도 운영자가 먼저 알아야 할 것은 쿼터다.
export const classifyRepoReadFailure = (
  error: unknown,
): RepoReadFallbackReason => {
  if (hasInChain(error, CodexQuotaExceededException)) {
    return RepoReadFallbackReason.QUOTA;
  }
  if (hasInChain(error, CodexReadLockException)) {
    return RepoReadFallbackReason.READ_LOCK;
  }
  if (hasInChain(error, CodexTimeoutException)) {
    return RepoReadFallbackReason.TIMEOUT;
  }
  return RepoReadFallbackReason.OTHER;
};
