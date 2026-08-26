import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { StrategyParameterPort } from '../domain/port/strategy-parameter.port';
import {
  ActiveStrategyParameter,
  STRATEGY_PARAMETER_NAMES,
  StrategyParameterName,
  StrategyParameterSeed,
  StrategyParameterSeedOutcome,
  StrategyParameterStrategy,
} from '../domain/strategy-parameter.type';

const isKnownName = (name: string): name is StrategyParameterName =>
  (STRATEGY_PARAMETER_NAMES as readonly string[]).includes(name);

@Injectable()
export class StrategyParameterPrismaRepository implements StrategyParameterPort {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveParameters(
    strategy: StrategyParameterStrategy,
  ): Promise<ActiveStrategyParameter[]> {
    const rows = await this.prisma.strategyParameter.findMany({
      where: {
        strategy,
        activatedAt: { not: null },
        supersededAt: null,
      },
      // 같은 이름에 활성 행이 둘이면 스키마가 아니라 쓰기 경로가 깨진 것이다. 그 상태에서도
      // 판정이 흔들리지 않도록 높은 버전을 앞에 두고, 읽는 쪽이 첫 행만 쓴다.
      orderBy: [{ name: 'asc' }, { version: 'desc' }],
      select: { name: true, value: true, version: true, reason: true },
    });

    const seen = new Set<StrategyParameterName>();
    const active: ActiveStrategyParameter[] = [];
    for (const row of rows) {
      // 코드가 모르는 이름은 건너뛴다. 이름을 지운 뒤에도 행은 남으므로, 모르는 값을
      // 그대로 흘려보내면 어디에도 쓰이지 않는 값이 활성으로 보인다.
      if (!isKnownName(row.name)) {
        continue;
      }
      if (seen.has(row.name)) {
        continue;
      }
      seen.add(row.name);
      active.push({
        name: row.name,
        value: row.value.toNumber(),
        version: row.version,
        reason: row.reason,
      });
    }
    return active;
  }

  /**
   * 활성 행이 없는 자리만 채운다. 이미 활성 행이 있으면 건드리지 않는다 — 씨앗을 다시
   * 뿌려서 사람이 승인한 값이 초기값으로 되돌아가면, 되돌린 사실조차 남지 않는다.
   *
   * 값을 바꾸는 경로가 아니다. 바꾸기는 새 버전을 만들어 활성화하는 일이고 PR ③ 이다.
   */
  async seedMissingParameters(
    seeds: StrategyParameterSeed[],
  ): Promise<StrategyParameterSeedOutcome> {
    const inserted: string[] = [];
    const skipped: string[] = [];
    for (const seed of seeds) {
      const label = `${seed.strategy}.${seed.name}`;
      const existing = await this.prisma.strategyParameter.findFirst({
        where: {
          strategy: seed.strategy,
          name: seed.name,
          activatedAt: { not: null },
          supersededAt: null,
        },
        select: { id: true },
      });
      if (existing !== null) {
        skipped.push(label);
        continue;
      }
      // 활성 행이 없어도 과거 행은 있을 수 있다(되돌리기로 비활성이 된 뒤). version 을
      // 1 로 박으면 그 자리에서 unique 가 깨진다.
      const latest = await this.prisma.strategyParameter.findFirst({
        where: { strategy: seed.strategy, name: seed.name },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      await this.prisma.strategyParameter.create({
        data: {
          strategy: seed.strategy,
          name: seed.name,
          value: seed.value.toString(),
          version: (latest?.version ?? 0) + 1,
          activatedAt: new Date(),
          reason: seed.reason,
        },
      });
      inserted.push(label);
    }
    return { inserted, skipped };
  }
}
