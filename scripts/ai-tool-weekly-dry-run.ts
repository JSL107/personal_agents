import { parseAiWeeklyMetrics } from '../src/ai-tool-weekly/domain/ai-weekly-metrics.parser';
import { resolveAiWeeklyPeriod } from '../src/ai-tool-weekly/domain/ai-weekly-period';
import { AiWeeklyMetricsRunner } from '../src/ai-tool-weekly/infrastructure/ai-weekly-metrics.runner';
import { getTodayKstDate } from '../src/common/util/kst-date.util';
import { formatAiToolWeekly } from '../src/slack/format/ai-tool-weekly.formatter';

const main = async (): Promise<void> => {
  const index = process.argv.indexOf('--fired-at');
  const firedAt = index >= 0 ? process.argv[index + 1] : getTodayKstDate();
  if (!firedAt || (index >= 0 && !/^\d{4}-\d{2}-\d{2}$/.test(firedAt))) {
    throw new Error('Invalid --fired-at');
  }
  const period = resolveAiWeeklyPeriod(firedAt);
  const raw = await new AiWeeklyMetricsRunner().run(period);
  const { metrics } = parseAiWeeklyMetrics(raw);
  const report = formatAiToolWeekly({
    period,
    metrics,
    pullRequests: { status: 'skipped' },
  });
  console.log(`${report.summary}\n\n--- 스레드 ---\n${report.detail}`);
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Unknown error');
  process.exitCode = 1;
});
