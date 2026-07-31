import { createHash } from 'node:crypto';

// 정규화는 최소한만 한다. 과하게 뭉개면 서로 다른 지적이 한 지문으로 합쳐져
// 두 번째 지적이 영구히 게시되지 않는다.
const normalizeBody = (body: string): string =>
  body.trim().replace(/\s+/g, ' ').toLowerCase();

export interface FindingFingerprintInput {
  repo: string;
  pullNumber: number;
  filePath: string | null;
  body: string;
}

// 재스윕 시 같은 지적을 다시 게시하지 않기 위한 유일 키.
// line 은 의도적으로 제외 — 같은 지적에 모델이 매번 다른 줄을 줄 수 있어,
// 줄이 달라도 같은 지적으로 뭉치는 편이 중복 게시보다 낫다.
export const buildFindingFingerprint = ({
  repo,
  pullNumber,
  filePath,
  body,
}: FindingFingerprintInput): string => {
  const source = [
    repo,
    String(pullNumber),
    filePath ?? '',
    normalizeBody(body),
  ].join('\n');
  return createHash('sha256').update(source).digest('hex');
};
