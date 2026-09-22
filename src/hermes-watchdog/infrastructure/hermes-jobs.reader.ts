import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { getRealHomeDir } from '../../model-router/infrastructure/cli-process.util';
import {
  HermesCronJobSnapshot,
  HermesCronSnapshot,
} from '../domain/hermes-watchdog.type';

const HERMES_JOBS_RELATIVE_PATH = join('cron', 'jobs.json');

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

// Hermes 의 cron 상태 파일(~/.hermes/cron/jobs.json)을 읽는다.
// Hermes 는 별도 프로세스라 DB·API 가 없다 — 이 파일이 유일한 관측 지점이다.
// 읽기/파싱 실패는 그대로 throw 한다: "Hermes 가 사라졌다" 자체가 알려야 할 상태다.
@Injectable()
export class HermesJobsReader {
  constructor(private readonly configService: ConfigService) {}

  resolvePath(): string {
    const configured = this.configService.get<string>('HERMES_HOME')?.trim();
    const home =
      configured && configured.length > 0
        ? configured
        : join(getRealHomeDir(), '.hermes');
    return join(home, HERMES_JOBS_RELATIVE_PATH);
  }

  async read(): Promise<HermesCronSnapshot> {
    const path = this.resolvePath();
    const raw = await readFile(path, 'utf-8');
    const parsed: unknown = JSON.parse(raw);

    if (!isRecord(parsed) || !Array.isArray(parsed.jobs)) {
      throw new Error(
        `Hermes cron 스냅샷 형식이 예상과 다릅니다 (jobs 배열 없음): ${path}`,
      );
    }

    return { jobs: parsed.jobs as HermesCronJobSnapshot[] };
  }
}
