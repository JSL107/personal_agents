import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { RunHumanizeResearchUsecase } from '../src/agent/humanize-research/application/run-humanize-research.usecase';
import { HumanizeResearchModule } from '../src/agent/humanize-research/humanize-research.module';
import { ConsoleEventBusModule } from '../src/console/console-event-bus.module';
import { PreviewGateModule } from '../src/preview-gate/preview-gate.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { formatHumanizeResearch } from '../src/slack/format/humanize-research.formatter';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    ConsoleEventBusModule,
    // BlogModule 이 승인 게이트 usecase 를 주입받는다. 이 스크립트는 승인 카드를 만들지 않으므로
    // applier 없이 띄운다(scripts/backfill-blog-date.ts 와 같은 방식).
    PreviewGateModule.forRoot({ appliers: [] }),
    HumanizeResearchModule,
  ],
})
class HumanizeResearchCliModule {}

const main = async (): Promise<void> => {
  const application = await NestFactory.createApplicationContext(
    HumanizeResearchCliModule,
    { logger: ['error', 'warn'] },
  );
  try {
    const research = application.get(RunHumanizeResearchUsecase);
    const result = await research.execute();
    console.log(formatHumanizeResearch(result.output));
    console.log(JSON.stringify(result.output, null, 2));
  } finally {
    await application.close();
  }
};

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
