import { ConfigService } from '@nestjs/config';

import { holidayCalendarOf } from '../../../holiday/domain/business-calendar';
import { HolidayCalendarPort } from '../../../holiday/domain/port/holiday-calendar.port';
import { JudgeMentionRequestUsecase } from '../../../schedule/application/judge-mention-request.usecase';
import { ScheduleRepositoryPort } from '../../../schedule/domain/port/schedule.repository.port';
import { ScheduleCollectionStateRepositoryPort } from '../../../schedule/domain/port/schedule-collection-state.repository.port';
import {
  ScheduleSource,
  ScheduleStatus,
} from '../../../schedule/domain/schedule.type';
import { ListMyMentionsUsecase } from '../../../slack-collector/application/list-my-mentions.usecase';
import { SlackCollectorPort } from '../../../slack-collector/domain/port/slack-collector.port';
import { SlackMention } from '../../../slack-collector/domain/slack-collector.type';
import { ScheduleCollectSlackAutopilotTask } from './schedule-collect-slack.autopilot-task';

describe('ScheduleCollectSlackAutopilotTask', () => {
  const repository = {
    findBySourceKey: jest.fn(),
    createCollected: jest.fn(),
    addEvent: jest.fn(),
  };
  const stateRepository = {
    get: jest.fn(),
    markSucceeded: jest.fn(),
  };
  const mentionsUsecase = { execute: jest.fn() };
  const collector = { getPermalink: jest.fn() };
  const judge = { execute: jest.fn() };
  const holidayCalendar = { load: jest.fn() };
  const configService = { get: jest.fn() };
  const mention = (
    offset: string,
    text = '<@UOWNER> 처리 부탁',
  ): SlackMention => ({
    channelId: 'C1',
    channelName: 'general',
    channelType: 'public_channel',
    authorUserId: 'UOTHER',
    fromBot: false,
    ts: `${Math.floor(Date.parse('2026-11-06T08:00:00Z') / 1000) + Number(offset.split('.')[0])}.${offset.split('.')[1]}`,
    text,
    permalink: undefined,
  });
  const task = new ScheduleCollectSlackAutopilotTask(
    repository as unknown as ScheduleRepositoryPort,
    stateRepository as unknown as ScheduleCollectionStateRepositoryPort,
    mentionsUsecase as unknown as ListMyMentionsUsecase,
    collector as unknown as SlackCollectorPort,
    judge as unknown as JudgeMentionRequestUsecase,
    holidayCalendar as unknown as HolidayCalendarPort,
    configService as unknown as ConfigService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-11-06T09:00:00Z'));
    configService.get.mockReturnValue('UOWNER');
    stateRepository.get.mockResolvedValue(null);
    repository.findBySourceKey.mockResolvedValue(null);
    repository.createCollected.mockResolvedValue('DUPLICATE');
    repository.addEvent.mockResolvedValue('DUPLICATE');
    collector.getPermalink.mockResolvedValue(
      'https://slack.com/archives/C1/p1',
    );
    judge.execute.mockResolvedValue({
      isRequest: true,
      title: '결제 API 처리',
      dueDate: null,
    });
    holidayCalendar.load.mockResolvedValue(holidayCalendarOf([]));
    mentionsUsecase.execute.mockResolvedValue([]);
  });

  afterEach(() => jest.useRealTimers());

  it('소유자가 없으면 멘션 조회를 하지 않고 건너뛴다', async () => {
    configService.get.mockReturnValue(undefined);
    expect(await task.run()).toEqual({ skip: true });
    expect(mentionsUsecase.execute).not.toHaveBeenCalled();
  });

  it('봇·본인·멘션 누락 메시지를 제외하고 이미 저장된 키를 판정하지 않는다', async () => {
    mentionsUsecase.execute.mockResolvedValue([
      { ...mention('1.0'), fromBot: true },
      { ...mention('2.0'), authorUserId: 'UOWNER' },
      mention('3.0', '요청이지만 멘션 없음'),
      mention('4.0'),
    ]);
    repository.findBySourceKey.mockResolvedValue({ id: 10 });
    await task.run();
    expect(judge.execute).not.toHaveBeenCalled();
    expect(repository.findBySourceKey).toHaveBeenCalledTimes(1);
    expect(stateRepository.markSucceeded).toHaveBeenCalledWith(
      ScheduleSource.SLACK_MENTION,
      expect.any(Date),
    );
  });

  it('최신부터 10건만 판정하고 남은 건이 있으면 하한을 갱신하지 않는다', async () => {
    mentionsUsecase.execute.mockResolvedValue(
      Array.from({ length: 11 }, (_, index) => mention(`${index + 1}.0`)),
    );
    await task.run();
    expect(judge.execute).toHaveBeenCalledTimes(10);
    expect(judge.execute.mock.calls[0][0].ts).toBe(mention('11.0').ts);
    expect(stateRepository.markSucceeded).not.toHaveBeenCalled();
  });

  it('비요청은 보이지 않는 SKIPPED 행으로 저장하고 permalink를 조회하지 않는다', async () => {
    mentionsUsecase.execute.mockResolvedValue([
      mention('1.0', `<@UOWNER> ${'가'.repeat(100)}`),
    ]);
    judge.execute.mockResolvedValue({
      isRequest: false,
      title: '무시',
      dueDate: null,
    });
    await task.run();
    expect(repository.createCollected).toHaveBeenCalledWith(
      expect.objectContaining({
        source: ScheduleSource.SLACK_MENTION,
        sourceKey: `C1:${mention('1.0').ts}`,
        status: ScheduleStatus.SKIPPED,
        dueDate: null,
        sourceUrl: null,
        title: expect.any(String),
      }),
    );
    expect(repository.createCollected.mock.calls[0][0].title).toHaveLength(60);
    expect(collector.getPermalink).not.toHaveBeenCalled();
  });

  it('요청은 후보 만료일·원문 메모·permalink와 함께 저장한다', async () => {
    mentionsUsecase.execute.mockResolvedValue([mention('1.0')]);
    await task.run();
    expect(repository.createCollected).toHaveBeenCalledWith(
      expect.objectContaining({
        status: ScheduleStatus.CANDIDATE,
        title: '결제 API 처리',
        sourceUrl: 'https://slack.com/archives/C1/p1',
        candidateExpiresAt: expect.any(Date),
        memo: '<@UOWNER> 처리 부탁',
      }),
    );
  });

  it('permalink 조회 실패에도 후보를 URL 없이 저장한다', async () => {
    mentionsUsecase.execute.mockResolvedValue([mention('1.0')]);
    collector.getPermalink.mockRejectedValue(new Error('unavailable'));
    await task.run();
    expect(repository.createCollected).toHaveBeenCalledWith(
      expect.objectContaining({
        status: ScheduleStatus.CANDIDATE,
        sourceUrl: null,
      }),
    );
    expect(stateRepository.markSucceeded).toHaveBeenCalledTimes(1);
  });

  it('판정 실패 시 행을 만들지 않고 하한도 갱신하지 않는다', async () => {
    mentionsUsecase.execute.mockResolvedValue([mention('1.0')]);
    judge.execute.mockResolvedValue(null);
    await task.run();
    expect(repository.createCollected).not.toHaveBeenCalled();
    expect(stateRepository.markSucceeded).not.toHaveBeenCalled();
  });

  it('채널 일부 조회 실패 시 strict 옵션으로 호출하고 커서를 갱신하지 않는다', async () => {
    mentionsUsecase.execute.mockRejectedValue(
      new Error('channel history failed'),
    );
    expect(await task.run()).toEqual({ skip: true });
    expect(mentionsUsecase.execute).toHaveBeenCalledWith(
      expect.objectContaining({ failOnChannelError: true }),
    );
    expect(stateRepository.markSucceeded).not.toHaveBeenCalled();
  });

  it('중복 저장 결과는 오류 없이 건너뛰고 조회 하한을 적용한다', async () => {
    stateRepository.get.mockResolvedValue(new Date('2026-11-06T08:00:00Z'));
    mentionsUsecase.execute.mockResolvedValue([mention('1.0')]);
    await expect(task.run()).resolves.toEqual({ skip: true });
    expect(mentionsUsecase.execute).toHaveBeenCalledWith(
      expect.objectContaining({ sinceHours: 3 }),
    );
    expect(stateRepository.markSucceeded).toHaveBeenCalledTimes(1);
  });

  it('올림한 sinceHours가 하한 이전 메시지를 반환해도 판정하지 않는다', async () => {
    stateRepository.get.mockResolvedValue(new Date('2026-11-06T08:30:00Z'));
    mentionsUsecase.execute.mockResolvedValue([
      {
        ...mention('1.0'),
        ts: String(Date.parse('2026-11-06T06:00:00Z') / 1000),
      },
      mention('2.0'),
    ]);
    await task.run();
    expect(judge.execute).toHaveBeenCalledTimes(1);
    expect(judge.execute.mock.calls[0][0].ts).toBe(mention('2.0').ts);
  });

  it('후보 만료는 멘션 시각이 아닌 수집 시각의 KST 등록일로 계산한다', async () => {
    mentionsUsecase.execute.mockResolvedValue([
      {
        ...mention('1.0'),
        ts: String(Date.parse('2026-11-04T03:00:00Z') / 1000),
      },
    ]);
    await task.run();
    expect(
      repository.createCollected.mock.calls[0][0].candidateExpiresAt,
    ).toEqual(new Date('2026-11-11T15:00:00Z'));
  });

  it('이미 판정한 메시지가 수정되면 재판정하지 않고 NOTE를 중복 없이 남긴다', async () => {
    mentionsUsecase.execute.mockResolvedValue([
      mention('1.0', '<@UOWNER> 수정된 요청'),
    ]);
    repository.findBySourceKey.mockResolvedValue({
      id: 10,
      status: ScheduleStatus.CANDIDATE,
      memo: '<@UOWNER> 원래 요청',
      title: '원래 요청',
    });
    await task.run();
    expect(judge.execute).not.toHaveBeenCalled();
    expect(repository.addEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleItemId: 10,
        kind: 'NOTE',
        dedupeKey: expect.stringMatching(/^slack-edit:/),
      }),
    );
  });
});
