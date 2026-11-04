import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DraftFollowUpMessageUsecase } from '../../../schedule/application/draft-follow-up-message.usecase';
import {
  plainDateToUtcDate,
  todayInKst,
} from '../../../schedule/domain/parse-due-date';
import { ScheduleRepositoryPort } from '../../../schedule/domain/port/schedule.repository.port';
import { ScheduleFollowUpRecord } from '../../../schedule/domain/schedule.repository.type';
import {
  FollowUpTrigger,
  ScheduleItemRecord,
  ScheduleStatus,
} from '../../../schedule/domain/schedule.type';
import { ScheduleReminderAutopilotTask } from './schedule-reminder.autopilot-task';

const claimAt = new Date('2026-11-04T05:00:00Z');
const item = {
  id: 7,
  slackUserId: 'U1',
  title: '결제 API',
  status: ScheduleStatus.OPEN,
  remindAt: new Date('2026-11-04T04:00:00Z'),
  deliveryClaimedAt: claimAt,
  sourceUrl: null,
} as ScheduleItemRecord;
const followUp = {
  id: 9,
  scheduleItemId: 7,
  recipient: 'PM',
  topic: '배포',
  trigger: FollowUpTrigger.AT_TIME,
  triggerAt: new Date('2026-11-04T04:00:00Z'),
  draft: null,
  deliveryClaimedAt: claimAt,
} as ScheduleFollowUpRecord;

describe('ScheduleReminderAutopilotTask', () => {
  const repository = {
    claimDueReminders: jest.fn(),
    expireCandidates: jest.fn(),
    claimDueFollowUps: jest.fn(),
    findDetail: jest.fn(),
    findById: jest.fn(),
    saveFollowUpDraft: jest.fn(),
    markReminded: jest.fn(),
    markFollowUpNotified: jest.fn(),
  };
  const draftUsecase = { execute: jest.fn() };
  const configService = { get: jest.fn() };
  const makeTask = () =>
    new ScheduleReminderAutopilotTask(
      repository as unknown as ScheduleRepositoryPort,
      draftUsecase as unknown as DraftFollowUpMessageUsecase,
      configService as unknown as ConfigService,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    configService.get.mockImplementation((key: string) =>
      key === 'CONSOLE_OWNER_SLACK_USER_ID' ? 'U1' : 'U1',
    );
    repository.claimDueReminders.mockResolvedValue([]);
    repository.expireCandidates.mockResolvedValue(1);
    repository.claimDueFollowUps.mockResolvedValue([]);
    repository.findDetail.mockResolvedValue({
      item,
      followUps: [],
      events: [],
      pendingFollowUpCount: 0,
    });
    repository.findById.mockResolvedValue(item);
    repository.saveFollowUpDraft.mockResolvedValue(true);
    draftUsecase.execute.mockResolvedValue('완료했습니다. 확인 부탁드립니다.');
  });

  // 한 줄에 종류·제목·마감을 몰아넣으면 읽히지 않았다(실서버 DM 확인). 아침 브리핑처럼 칸을 나눈다.
  it('내 알림과 연락할 일을 칸으로 나누고 마감은 오늘·내일로 쓴다', async () => {
    const today = plainDateToUtcDate(todayInKst(new Date()));
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    repository.claimDueReminders.mockResolvedValue([
      { ...item, title: '결제 API 배포', dueDate: today, dueTime: '12:01' },
      { ...item, id: 8, title: '세금', dueDate: tomorrow, dueTime: null },
      { ...item, id: 10, title: '로그 확인', dueDate: null, dueTime: null },
    ]);
    repository.claimDueFollowUps.mockResolvedValue([followUp]);
    draftUsecase.execute.mockResolvedValue(
      '배포 끝났습니다.\n확인 부탁드려요.',
    );
    const result = await makeTask().run();
    expect(result.summaryText).toBe(
      [
        '*지금 챙길 일*',
        '• 결제 API 배포 · 오늘 12:01 마감',
        '• 세금 · 내일 마감',
        '• 로그 확인',
        '',
        '*연락할 때*',
        '• PM에게 배포 (결제 API)',
        '  > 배포 끝났습니다.',
        '  > 확인 부탁드려요.',
      ].join('\n'),
    );
  });

  it('선점 0건이어도 후보를 만료하고 발송을 건너뛴다', async () => {
    const result = await makeTask().run();
    expect(result).toEqual({ skip: true });
    expect(repository.expireCandidates).toHaveBeenCalledTimes(1);
  });

  it('선점 항목 두 건을 한 DM에 넣고 순서와 무관한 guardKeySuffix를 만든다', async () => {
    repository.claimDueReminders.mockResolvedValue([
      item,
      { ...item, id: 8, title: '세금' },
    ]);
    const first = await makeTask().run();
    repository.claimDueReminders.mockResolvedValue([
      { ...item, id: 8, title: '세금' },
      item,
    ]);
    const second = await makeTask().run();
    expect(first.summaryText).toContain('결제 API');
    expect(first.summaryText).toContain('세금');
    expect(first.guardKeySuffix).toBe(second.guardKeySuffix);
    repository.claimDueReminders.mockResolvedValue([
      { ...item, deliveryClaimedAt: new Date('2026-11-04T05:01:00Z') },
    ]);
    expect((await makeTask().run()).guardKeySuffix).not.toBe(
      first.guardKeySuffix,
    );
  });

  it('발송 성공 뒤에만 원래 선점 시각과 알림 시각으로 표식한다', async () => {
    repository.claimDueReminders.mockResolvedValue([item]);
    repository.claimDueFollowUps.mockResolvedValue([followUp]);
    const result = await makeTask().run();
    expect(repository.markReminded).not.toHaveBeenCalled();
    expect(repository.markFollowUpNotified).not.toHaveBeenCalled();
    expect(repository.saveFollowUpDraft).toHaveBeenCalledWith({
      id: 9,
      claimAt,
      draft: '완료했습니다. 확인 부탁드립니다.',
    });
    await result.onDelivered?.();
    expect(repository.markReminded).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7, claimAt, reminderAt: item.remindAt }),
    );
    expect(repository.markFollowUpNotified).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 9,
        claimAt,
        triggerAt: followUp.triggerAt,
      }),
    );
  });

  it('초안 생성 실패에도 연락할 일 알림을 내보낸다', async () => {
    repository.claimDueFollowUps.mockResolvedValue([followUp]);
    draftUsecase.execute.mockResolvedValue(null);
    const result = await makeTask().run();
    expect(result.summaryText).toContain('• PM에게 배포 (결제 API)');
  });

  it('이미 저장된 초안을 재사용하고 모델을 다시 부르지 않는다', async () => {
    repository.claimDueFollowUps.mockResolvedValue([
      { ...followUp, draft: '저장된 초안' },
    ]);
    const result = await makeTask().run();
    expect(result.summaryText).toContain('저장된 초안');
    expect(draftUsecase.execute).not.toHaveBeenCalled();
    expect(repository.saveFollowUpDraft).not.toHaveBeenCalled();
  });

  it('초안 생성 후 업무가 SKIPPED로 바뀌면 발송하지 않는다', async () => {
    repository.claimDueFollowUps.mockResolvedValue([followUp]);
    repository.findById.mockResolvedValue({
      ...item,
      status: ScheduleStatus.SKIPPED,
    });
    expect((await makeTask().run()).skip).toBe(true);
    expect(repository.findById).toHaveBeenCalledWith(7);
  });

  it('최근 사건 10개만 초안에 넣고 Slack 링크 제어 문자를 escape한다', async () => {
    repository.claimDueFollowUps.mockResolvedValue([
      { ...followUp, recipient: 'P<M', topic: '*배포*' },
    ]);
    repository.findDetail.mockResolvedValue({
      item: { ...item, title: '결제*API' },
      followUps: [],
      events: Array.from({ length: 11 }, (_, index) => ({ id: index })),
    });
    const result = await makeTask().run();
    expect(draftUsecase.execute.mock.calls[0][0].recentEvents).toHaveLength(10);
    expect(result.summaryText).not.toContain('P<M');
    expect(result.summaryText).toContain('P&lt;M');
  });

  it('ON_DONE은 현재 DONE이고 AT_TIME은 현재 SKIPPED가 아닐 때만 보낸다', async () => {
    repository.claimDueFollowUps.mockResolvedValue([
      { ...followUp, trigger: FollowUpTrigger.ON_DONE },
    ]);
    expect((await makeTask().run()).skip).toBe(true);
    repository.claimDueFollowUps.mockResolvedValue([followUp]);
    repository.findDetail.mockResolvedValue({
      item: { ...item, status: ScheduleStatus.SKIPPED },
      followUps: [],
      events: [],
    });
    expect((await makeTask().run()).skip).toBe(true);
  });

  it('소유자가 없으면 저장소를 읽지 않는다', async () => {
    configService.get.mockReturnValue(undefined);
    expect((await makeTask().run()).skip).toBe(true);
    expect(repository.claimDueReminders).not.toHaveBeenCalled();
  });

  it('업무 소유자와 DM 소유자가 다르면 생성 시 한 번 경고한다', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    configService.get.mockImplementation((key: string) =>
      key === 'CONSOLE_OWNER_SLACK_USER_ID' ? 'U1' : 'U2',
    );
    makeTask();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
