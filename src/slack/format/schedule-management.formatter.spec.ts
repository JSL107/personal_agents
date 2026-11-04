import { ManagementAction } from '../../schedule/domain/management-intent.type';
import {
  FollowUpTrigger,
  ScheduleStatus,
} from '../../schedule/domain/schedule.type';
import { formatManagementReply } from './schedule-management.formatter';

describe('formatManagementReply', () => {
  it('상태 변경을 동작별로 답하고 제목을 escape한다', () => {
    expect(
      formatManagementReply({
        title: '결제 <API>',
        intent: {
          action: ManagementAction.STATUS,
          titleQuery: '결제',
          status: ScheduleStatus.IN_PROGRESS,
        },
      }),
    ).toBe('결제 &lt;API&gt; → 진행 중으로 바꿨어요');
  });
  it('알림 시각을 KST로 답한다', () => {
    expect(
      formatManagementReply({
        title: '결제 API',
        intent: {
          action: ManagementAction.REMIND,
          titleQuery: '결제',
          remindAt: new Date('2026-11-05T06:00:00Z'),
        },
      }),
    ).toBe('결제 API 11월 5일 15:00에 알려 드릴게요');
  });
  it('연락할 일의 수신자·주제를 escape한다', () => {
    expect(
      formatManagementReply({
        title: '결제 API',
        intent: {
          action: ManagementAction.FOLLOW_UP,
          titleQuery: '결제',
          trigger: FollowUpTrigger.ON_DONE,
          recipient: '<PM>',
          topic: 'A&B',
        },
      }),
    ).toBe('결제 API 끝나면 &lt;PM&gt;에게 A&amp;B 알릴 때를 챙길게요');
  });
  it('메모 답장을 낸다', () => {
    expect(
      formatManagementReply({
        title: '결제 API',
        intent: {
          action: ManagementAction.NOTE,
          titleQuery: '결제',
          note: 'ok',
        },
      }),
    ).toBe('결제 API에 메모를 남겼어요');
  });

  it('완료 상태와 정해진 연락 시각을 각각 표기한다', () => {
    expect(
      formatManagementReply({
        title: '결제 API',
        intent: {
          action: ManagementAction.STATUS,
          titleQuery: '결제 API',
          status: ScheduleStatus.DONE,
        },
      }),
    ).toBe('결제 API → 완료로 바꿨어요');
    expect(
      formatManagementReply({
        title: '결제 API',
        intent: {
          action: ManagementAction.FOLLOW_UP,
          titleQuery: '결제 API',
          trigger: FollowUpTrigger.AT_TIME,
          triggerAt: new Date('2026-11-05T06:00:00Z'),
          recipient: 'PM',
          topic: '공유',
        },
      }),
    ).toBe('결제 API 11월 5일 15:00에 PM에게 공유 알릴 때를 챙길게요');
  });
});
