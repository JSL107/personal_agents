import type { SessionInjectService } from '../../local-sessions/application/session-inject.service';
import {
  PREVIEW_KIND,
  type PreviewAction,
} from '../../preview-gate/domain/preview-action.type';
import { SessionInjectPreviewApplier } from './session-inject.applier';

function makeApplier(injectResult: { ok: boolean; reason?: string }) {
  const sessionInject = {
    inject: jest.fn().mockReturnValue(injectResult),
  } as unknown as SessionInjectService;
  return {
    applier: new SessionInjectPreviewApplier(sessionInject),
    sessionInject,
  };
}

function makePreview(): PreviewAction {
  return {
    id: 'p1',
    slackUserId: 'U1',
    kind: PREVIEW_KIND.SESSION_INJECT,
    payload: {
      sessionId: 's1',
      source: 'claude',
      instruction: 'PR 리뷰',
      prRef: 'o/r#1',
    },
    status: 'PENDING',
    previewText: 't',
    responseUrl: '',
    expiresAt: new Date(),
    createdAt: new Date(),
    appliedAt: null,
    cancelledAt: null,
    slackChannelId: null,
    slackMessageTs: null,
  };
}

describe('SessionInjectPreviewApplier', () => {
  it('kind 는 SESSION_INJECT', () => {
    const { applier } = makeApplier({ ok: true });

    expect(applier.kind).toBe(PREVIEW_KIND.SESSION_INJECT);
  });

  it('apply 는 payload.instruction 을 세션에 inject 하고 artifacts 는 빈 배열', async () => {
    const { applier, sessionInject } = makeApplier({ ok: true });

    const result = await applier.apply(makePreview());

    expect(sessionInject.inject).toHaveBeenCalledWith('s1', 'PR 리뷰');
    expect(result.artifacts).toEqual([]);
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('세션 소실(inject 실패)이면 graceful 메시지', async () => {
    const { applier } = makeApplier({
      ok: false,
      reason: 'SESSION_NOT_FOUND',
    });

    const result = await applier.apply(makePreview());

    expect(result.message).toContain('세션');
    expect(result.artifacts).toEqual([]);
  });

  it('payload 형식이 잘못되면 inject 전에 실패한다', async () => {
    const { applier, sessionInject } = makeApplier({ ok: true });
    const preview = {
      ...makePreview(),
      payload: {
        sessionId: 's1',
        source: 'claude',
        prRef: 'o/r#1',
      },
    };

    await expect(applier.apply(preview)).rejects.toThrow(
      'SessionInjectPreviewPayload',
    );
    expect(sessionInject.inject).not.toHaveBeenCalled();
  });
});
