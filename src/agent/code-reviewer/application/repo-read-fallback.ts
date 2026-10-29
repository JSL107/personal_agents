import { findInModelErrorChain } from '../../../model-router/application/extract-codex-quota';
import {
  CodexQuotaExceededException,
  CodexReadLockException,
  CodexTimeoutException,
} from '../../../model-router/infrastructure/codex-cli.provider';
import { RepoReadFallbackReason } from '../domain/code-reviewer.type';

// 앞선 것이 이긴다. 쿼터가 가장 앞인 이유는 후퇴 재실행이 claude 로 바로 넘어가는 원인이라서다 —
// 같은 체인에 타임아웃이 섞여 있어도 운영자가 먼저 알아야 할 것은 쿼터다.
const CLASSIFIERS: readonly [
  RepoReadFallbackReason,
  new (...args: never[]) => Error,
][] = [
  [RepoReadFallbackReason.QUOTA, CodexQuotaExceededException],
  [RepoReadFallbackReason.READ_LOCK, CodexReadLockException],
  [RepoReadFallbackReason.TIMEOUT, CodexTimeoutException],
];

export const classifyRepoReadFailure = (
  error: unknown,
): RepoReadFallbackReason => {
  const found = CLASSIFIERS.find(
    ([, type]) =>
      findInModelErrorChain(
        error,
        (value): value is Error => value instanceof type,
      ) !== null,
  );
  return found === undefined ? RepoReadFallbackReason.OTHER : found[0];
};
