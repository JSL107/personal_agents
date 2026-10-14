import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ArtJobListResult } from '../domain/art-job-feed.type';
import { ArtJobSourcePort } from '../domain/port/art-job-feed.ports';
import { mapSaraminList } from './saramin.mapper';

const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 10_000;
// 문서의 복수 코드 표기 기준이며 실측 전이다.
const JOB_CODES = '1562+1477';

const sleep = (milliseconds: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
};

@Injectable()
export class SaraminSource implements ArtJobSourcePort {
  readonly source = 'saramin' as const;

  constructor(private readonly configService: ConfigService) {}

  async fetchLatest(page: number): Promise<ArtJobListResult> {
    const accessKey = this.configService
      .get<string>('SARAMIN_ACCESS_KEY')
      ?.trim();
    if (!accessKey) {
      return { received: 0, listings: [] };
    }
    const url = new URL('https://oapi.saramin.co.kr/job-search');
    url.searchParams.set('access-key', accessKey);
    url.searchParams.set('job_mid_cd', '15');
    url.searchParams.set('job_cd', JOB_CODES);
    url.searchParams.set('sort', 'pd');
    url.searchParams.set('count', '40');
    url.searchParams.set('start', String(page - 1));

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(url, {
          headers: { Accept: 'application/json' },
          redirect: 'manual',
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (response.status >= 300 && response.status < 400) {
          throw new Error('사람인 인증 실패(리다이렉트)');
        }
        if (!response.ok) {
          const error = new Error(`사람인 요청 실패: HTTP ${response.status}`);
          if (response.status !== 429 && response.status < 500) {
            throw Object.assign(error, { permanent: true });
          }
          throw error;
        }
        const payload: unknown = await response.json();
        return mapSaraminList(payload);
      } catch (error) {
        const permanent =
          error instanceof Error &&
          (error.message === '사람인 인증 실패(리다이렉트)' ||
            (error as Error & { permanent?: boolean }).permanent);
        if (permanent || attempt === MAX_ATTEMPTS - 1) {
          // fetch 오류에는 원본 URL이 포함될 수 있으므로 외부 메시지를 전달하지 않는다.
          if (permanent && error instanceof Error) {
            throw error;
          }
          throw new Error('사람인 요청 실패');
        }
        await sleep(1_000 * 2 ** attempt);
      }
    }
    throw new Error('사람인 요청 실패');
  }

  // job-search 응답에는 본문이 없다(제목·직무 코드뿐). 스타일 태그는 제목으로만 잡힌다.
  async fetchPostingBody(): Promise<string> {
    return '';
  }

  // 사람인에는 게임잡의 「대표게임」 같은 회사 정보가 없다.
  async fetchRepresentativeGames(): Promise<string[]> {
    return [];
  }
}
