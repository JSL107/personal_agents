import { TriggerType } from '../../agent-run/domain/agent-run.type';
import { AgentType } from '../../model-router/domain/model-router.type';
import { StudyBriefCronConsumer } from './study-brief-cron.consumer';

const PROFILE = {
  id: 1,
  agentRunId: 2,
  profileJson: {
    summary: 'NestJS 백엔드 개발자',
    skills: [
      {
        name: 'TypeScript',
        category: 'LANGUAGE',
        proficiency: 'EXPERT',
        evidence: [{ repo: 'owner/repo', pr: 1, url: 'https://example.com' }],
      },
    ],
    accomplishments: [],
    meta: { githubLogin: 'owner', windowStart: '2026-07-01', prCount: 1 },
  },
  createdAt: new Date('2026-08-01T00:00:00Z'),
};

const RESEARCH =
  'KIND: CONCEPT\nTOPIC: durable execution\nSOURCES: https://example.com\n---\n조사 전문';

const makeCronIdempotencyFake = () => {
  const keys = new Set<string>();
  return {
    isDone: jest.fn((key: string) => Promise.resolve(keys.has(key))),
    acquireOnce: jest.fn((key: string) => {
      if (keys.has(key)) {
        return Promise.resolve(false);
      }
      keys.add(key);
      return Promise.resolve(true);
    }),
    release: jest.fn((key: string) => {
      keys.delete(key);
      return Promise.resolve();
    }),
  };
};

const makeConsumer = ({
  profile = PROFILE,
  hermesOutput = RESEARCH,
  hermesError,
  cronIdempotency = makeCronIdempotencyFake(),
  notionDatabaseId,
  notionError,
  notionUrlUpdateError,
}: {
  profile?: typeof PROFILE | null;
  hermesOutput?: string;
  hermesError?: Error;
  cronIdempotency?: ReturnType<typeof makeCronIdempotencyFake>;
  notionDatabaseId?: string;
  notionError?: Error;
  notionUrlUpdateError?: Error;
} = {}) => {
  const evaluateStudyTopic = {
    execute: jest.fn().mockResolvedValue({
      result: {
        kind: 'CONCEPT',
        whyNow: '지금 필요',
        whereItLands: 'src/agent-run/',
        minutes: 20,
      },
      modelUsed: 'codex-cli',
      agentRunId: 41,
    }),
  };
  const profileRepository = {
    findLatestBySlackUser: jest.fn().mockResolvedValue(profile),
  };
  const hermesRunner = {
    run: hermesError
      ? jest.fn().mockRejectedValue(hermesError)
      : jest.fn().mockResolvedValue({ stdout: hermesOutput, stderr: '' }),
  };
  const studyBriefRepository = {
    findRecentSince: jest.fn().mockResolvedValue([]),
    save: jest.fn().mockResolvedValue({ id: 7 }),
    updateNotionUrl: notionUrlUpdateError
      ? jest.fn().mockRejectedValue(notionUrlUpdateError)
      : jest.fn().mockResolvedValue(undefined),
  };
  const installedTools = { collect: jest.fn().mockResolvedValue(['serena']) };
  const repoContext = {
    collect: jest
      .fn()
      .mockResolvedValue([
        { name: 'agent-run', description: '에이전트 실행 수명주기' },
      ]),
  };
  const studyBriefPublisher = {
    publish: notionError
      ? jest.fn().mockRejectedValue(notionError)
      : jest.fn().mockResolvedValue({
          pageId: 'PAGE',
          url: 'https://notion.so/PAGE',
        }),
  };
  const generateStudyDiagram = {
    execute: jest.fn().mockResolvedValue(null),
  };
  const notionFileUpload = {
    uploadImage: jest.fn().mockResolvedValue('upload-1'),
  };
  const slackNotifier = {
    postMessage: jest.fn().mockResolvedValue({ ts: 'T1' }),
  };
  const notificationPublisher = { publishCronFailure: jest.fn() };
  const configService = {
    get: jest.fn((key: string) =>
      key === 'STUDY_BRIEF_NOTION_DATABASE_ID' ? notionDatabaseId : undefined,
    ),
  };
  // 판정 전 실패를 원장에 남기는 경로. 실제 execute 처럼 run 을 실행해 실패면 그대로 던진다.
  const agentRunService = {
    execute: jest
      .fn()
      .mockImplementation(
        async ({
          run,
        }: {
          run: (context: { agentRunId: number }) => Promise<unknown>;
        }) => {
          await run({ agentRunId: 99 });
          return { result: null, modelUsed: 'stub', agentRunId: 99 };
        },
      ),
  };
  const consumer = new StudyBriefCronConsumer(
    evaluateStudyTopic as never,
    profileRepository as never,
    hermesRunner as never,
    studyBriefRepository as never,
    installedTools as never,
    repoContext as never,
    studyBriefPublisher as never,
    generateStudyDiagram as never,
    notionFileUpload as never,
    slackNotifier as never,
    cronIdempotency as never,
    configService as never,
    agentRunService as never,
    notificationPublisher as never,
  );

  return {
    consumer,
    agentRunService,
    evaluateStudyTopic,
    profileRepository,
    hermesRunner,
    studyBriefRepository,
    installedTools,
    repoContext,
    studyBriefPublisher,
    generateStudyDiagram,
    notionFileUpload,
    slackNotifier,
    notificationPublisher,
    cronIdempotency,
    configService,
  };
};

const JOB = {
  data: { ownerSlackUserId: 'U1', target: 'C1' },
};

describe('StudyBriefCronConsumer', () => {
  it('Hermes 조사 후 CTO 판정, 저장, Slack 카드·스레드 순으로 처리한다', async () => {
    const dependencies = makeConsumer();

    await dependencies.consumer.process(JOB as never);

    expect(dependencies.hermesRunner.run).toHaveBeenCalledTimes(1);
    expect(dependencies.evaluateStudyTopic.execute).toHaveBeenCalledTimes(1);
    expect(dependencies.studyBriefRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        agentRunId: 41,
        ownerUserId: 'U1',
        topic: 'durable execution',
      }),
    );
    expect(dependencies.slackNotifier.postMessage).toHaveBeenCalledTimes(2);
    expect(
      dependencies.studyBriefRepository.save.mock.invocationCallOrder[0],
    ).toBeLessThan(
      dependencies.slackNotifier.postMessage.mock.invocationCallOrder[0],
    );
    expect(dependencies.slackNotifier.postMessage.mock.calls[1][0]).toEqual(
      expect.objectContaining({ target: 'C1', threadTs: 'T1' }),
    );
  });

  it('NO_TOPIC이면 CTO·저장·발송 없이 정상 종료한다', async () => {
    const dependencies = makeConsumer({
      hermesOutput: 'NO_TOPIC: 최근 주제와 모두 중복됨',
    });

    await expect(
      dependencies.consumer.process(JOB as never),
    ).resolves.toBeUndefined();
    expect(dependencies.evaluateStudyTopic.execute).not.toHaveBeenCalled();
    expect(dependencies.studyBriefRepository.save).not.toHaveBeenCalled();
    expect(dependencies.slackNotifier.postMessage).not.toHaveBeenCalled();
  });

  it('Hermes 실패면 owner DM을 발행하고 Slack 발송 없이 throw한다', async () => {
    const dependencies = makeConsumer({
      hermesError: new Error('hermes down'),
    });

    await expect(dependencies.consumer.process(JOB as never)).rejects.toThrow(
      'hermes down',
    );
    expect(
      dependencies.notificationPublisher.publishCronFailure,
    ).toHaveBeenCalledTimes(1);
    expect(dependencies.slackNotifier.postMessage).not.toHaveBeenCalled();
  });

  it('Hermes 실패를 실행 원장에 CTO_STUDY 실패로 남긴다', async () => {
    const dependencies = makeConsumer({
      hermesError: new Error('hermes down'),
    });

    await expect(dependencies.consumer.process(JOB as never)).rejects.toThrow(
      'hermes down',
    );
    // 통지만 가고 원장이 비면 "실패한 날" 과 "발화하지 않은 날" 이 구분되지 않는다.
    expect(dependencies.agentRunService.execute).toHaveBeenCalledTimes(1);
    expect(dependencies.agentRunService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: AgentType.CTO_STUDY,
        triggerType: TriggerType.STUDY_BRIEF_CRON,
      }),
    );
  });

  it('CTO 판정 뒤 실패는 원장에 중복 기록하지 않는다', async () => {
    const dependencies = makeConsumer({});
    dependencies.studyBriefRepository.save.mockRejectedValue(
      new Error('save down'),
    );

    await expect(dependencies.consumer.process(JOB as never)).rejects.toThrow(
      'save down',
    );
    // 판정 usecase 가 이미 AgentRun 을 남겼으므로 여기서 또 남기면 실패가 두 번 세어진다.
    expect(dependencies.agentRunService.execute).not.toHaveBeenCalled();
  });

  it('CTO 판정 자체가 실패해도 원장에 중복 기록하지 않는다', async () => {
    const dependencies = makeConsumer({});
    dependencies.evaluateStudyTopic.execute.mockRejectedValue(
      new Error('verdict down'),
    );

    await expect(dependencies.consumer.process(JOB as never)).rejects.toThrow(
      'verdict down',
    );
    // 판정 usecase 는 자기 AgentRun 을 FAILED 로 마감한 뒤 던진다. 성공 시점에만 표시하면
    // 이 경로가 판정 전 실패로 잘못 분류돼 같은 실패가 두 건으로 남는다.
    expect(dependencies.agentRunService.execute).not.toHaveBeenCalled();
  });

  it('프로필이 없어도 기본 개인화로 Hermes를 호출한다', async () => {
    const dependencies = makeConsumer({ profile: null });

    await dependencies.consumer.process(JOB as never);

    expect(dependencies.hermesRunner.run).toHaveBeenCalledTimes(1);
  });

  it('Hermes 프롬프트에는 프로필 서술문을 빼고 스킬과 숙련도만 넣는다', async () => {
    const dependencies = makeConsumer();

    await dependencies.consumer.process(JOB as never);

    const prompt = dependencies.hermesRunner.run.mock.calls[0][0];
    expect(prompt).not.toContain(PROFILE.profileJson.summary);
    expect(prompt).toContain('TypeScript(EXPERT)');
    expect(dependencies.evaluateStudyTopic.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        profileSummary: PROFILE.profileJson.summary,
        repoModules: [
          { name: 'agent-run', description: '에이전트 실행 수명주기' },
        ],
      }),
    );
  });

  it('Notion 성공 시 URL을 저장하고 링크형 Slack 카드만 한 번 발송한다', async () => {
    const dependencies = makeConsumer({
      notionDatabaseId: 'DATABASE',
      hermesOutput:
        'KIND: CONCEPT\nTOPIC: durable execution\n---\n## 세 줄 요약\n첫 문장\n둘째 문장\n셋째 문장',
    });

    await dependencies.consumer.process(JOB as never);

    expect(dependencies.studyBriefPublisher.publish).toHaveBeenCalledTimes(1);
    expect(
      dependencies.studyBriefRepository.updateNotionUrl,
    ).toHaveBeenCalledWith(7, 'https://notion.so/PAGE');
    expect(dependencies.slackNotifier.postMessage).toHaveBeenCalledTimes(1);
    expect(dependencies.slackNotifier.postMessage).toHaveBeenCalledWith({
      target: 'C1',
      text: expect.stringContaining(
        '<https://notion.so/PAGE|Notion에서 전체 읽기>',
      ),
    });
  });

  it('Notion URL 저장만 실패하면 warn 후 링크형 Slack 카드를 발송한다', async () => {
    const dependencies = makeConsumer({
      notionDatabaseId: 'DATABASE',
      notionUrlUpdateError: new Error('database down'),
      hermesOutput:
        'KIND: CONCEPT\nTOPIC: durable execution\n---\n## 세 줄 요약\n첫 문장\n둘째 문장\n셋째 문장',
    });
    const warn = jest
      .spyOn(dependencies.consumer['logger'], 'warn')
      .mockImplementation();

    try {
      await expect(
        dependencies.consumer.process(JOB as never),
      ).resolves.toBeUndefined();
      expect(dependencies.studyBriefPublisher.publish).toHaveBeenCalledTimes(1);
      expect(
        dependencies.studyBriefRepository.updateNotionUrl,
      ).toHaveBeenCalledWith(7, 'https://notion.so/PAGE');
      expect(dependencies.slackNotifier.postMessage).toHaveBeenCalledTimes(1);
      expect(dependencies.slackNotifier.postMessage).toHaveBeenCalledWith({
        target: 'C1',
        text: expect.stringContaining(
          '<https://notion.so/PAGE|Notion에서 전체 읽기>',
        ),
      });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'Study Brief Notion URL 저장 실패 — 링크 발송은 유지: database down',
        ),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('Notion 실패는 throw하지 않고 전체 카드와 스레드로 fallback한다', async () => {
    const dependencies = makeConsumer({
      notionDatabaseId: 'DATABASE',
      notionError: new Error('notion down'),
    });
    const warn = jest
      .spyOn(dependencies.consumer['logger'], 'warn')
      .mockImplementation();

    try {
      await expect(
        dependencies.consumer.process(JOB as never),
      ).resolves.toBeUndefined();

      expect(
        dependencies.studyBriefRepository.updateNotionUrl,
      ).not.toHaveBeenCalled();
      expect(dependencies.slackNotifier.postMessage).toHaveBeenCalledTimes(2);
      expect(dependencies.slackNotifier.postMessage.mock.calls[1][0]).toEqual(
        expect.objectContaining({ threadTs: 'T1' }),
      );
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'Study Brief Notion 페이지 발행 실패 — Slack 전체 카드로 대체: notion down',
        ),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('Notion DB가 미설정이면 발행하지 않고 기존 전체 카드와 스레드를 보낸다', async () => {
    const dependencies = makeConsumer();

    await dependencies.consumer.process(JOB as never);

    expect(dependencies.studyBriefPublisher.publish).not.toHaveBeenCalled();
    expect(dependencies.slackNotifier.postMessage).toHaveBeenCalledTimes(2);
  });

  it('조사 본문이 3,000자를 넘으면 차단하지 않고 warn한다', async () => {
    const dependencies = makeConsumer({
      hermesOutput: `KIND: CONCEPT\nTOPIC: long report\n---\n${'가'.repeat(3_001)}`,
    });
    const warn = jest
      .spyOn(dependencies.consumer['logger'], 'warn')
      .mockImplementation();

    try {
      await dependencies.consumer.process(JOB as never);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('조사 본문 3,000자 초과'),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('같은 날 두 번째 처리에서는 발송을 건너뛴다', async () => {
    const dependencies = makeConsumer();

    await dependencies.consumer.process(JOB as never);
    await dependencies.consumer.process(JOB as never);

    expect(dependencies.slackNotifier.postMessage).toHaveBeenCalledTimes(2);
    expect(dependencies.studyBriefRepository.save).toHaveBeenCalledTimes(1);
  });

  it('owner 가 다르면 같은 날에도 각각 처리된다 (가드 키에 owner 포함)', async () => {
    const dependencies = makeConsumer();

    await dependencies.consumer.process(JOB as never);
    await dependencies.consumer.process({
      data: { ownerSlackUserId: 'U2', target: 'C2' },
    } as never);

    expect(dependencies.studyBriefRepository.save).toHaveBeenCalledTimes(2);
  });

  it('완료 key 반영 전 겹친 처리도 저장 전에 차단한다', async () => {
    const cronIdempotency = makeCronIdempotencyFake();
    cronIdempotency.isDone.mockResolvedValue(false);
    cronIdempotency.acquireOnce
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const dependencies = makeConsumer({
      cronIdempotency,
    });

    await dependencies.consumer.process(JOB as never);
    await dependencies.consumer.process(JOB as never);

    expect(dependencies.hermesRunner.run).toHaveBeenCalledTimes(1);
    expect(dependencies.studyBriefRepository.save).toHaveBeenCalledTimes(1);
    expect(dependencies.slackNotifier.postMessage).toHaveBeenCalledTimes(2);
  });

  it('Slack 발송 실패 알림에 놓친 주제명을 포함한다', async () => {
    const dependencies = makeConsumer();
    dependencies.slackNotifier.postMessage.mockRejectedValue(
      new Error('slack down'),
    );

    await expect(dependencies.consumer.process(JOB as never)).rejects.toThrow(
      'durable execution',
    );
    expect(
      dependencies.notificationPublisher.publishCronFailure.mock.calls[0][0]
        .errorMessage,
    ).toContain('durable execution');
    expect(dependencies.cronIdempotency.release).toHaveBeenCalledTimes(1);
    expect(dependencies.cronIdempotency.release).toHaveBeenCalledWith(
      expect.stringMatching(
        /^cron:study-brief-cron:U1:\d{4}-\d{2}-\d{2}:processing$/,
      ),
    );
  });

  it('요약 발송 실패 후 재시도해도 조사·판정·저장을 반복하지 않는다', async () => {
    const dependencies = makeConsumer();
    dependencies.slackNotifier.postMessage.mockRejectedValue(
      new Error('slack down'),
    );

    await expect(dependencies.consumer.process(JOB as never)).rejects.toThrow(
      'slack down',
    );
    await expect(
      dependencies.consumer.process(JOB as never),
    ).resolves.toBeUndefined();

    expect(dependencies.hermesRunner.run).toHaveBeenCalledTimes(1);
    expect(dependencies.evaluateStudyTopic.execute).toHaveBeenCalledTimes(1);
    expect(dependencies.studyBriefRepository.save).toHaveBeenCalledTimes(1);
  });

  it('상세 스레드 발송 실패는 요약 발송을 무효화하지 않는다', async () => {
    const dependencies = makeConsumer();
    const warn = jest
      .spyOn(dependencies.consumer['logger'], 'warn')
      .mockImplementation();
    dependencies.slackNotifier.postMessage
      .mockResolvedValueOnce({ ts: 'T1' })
      .mockRejectedValueOnce(new Error('thread down'));

    try {
      await expect(
        dependencies.consumer.process(JOB as never),
      ).resolves.toBeUndefined();
      expect(
        dependencies.notificationPublisher.publishCronFailure,
      ).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'Study Brief Cron 상세 스레드 발송 실패 — 요약만 전달됨: thread down',
        ),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('그림이 만들어지면 업로드해서 퍼블리셔에 넘긴다', async () => {
    const dependencies = makeConsumer({ notionDatabaseId: 'DATABASE' });
    dependencies.generateStudyDiagram.execute.mockResolvedValue({
      png: Buffer.from('png'),
      html: '<html></html>',
      violations: [],
    });
    dependencies.notionFileUpload.uploadImage.mockResolvedValue('upload-1');

    await dependencies.consumer.process(JOB as never);

    expect(dependencies.studyBriefPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ diagramFileUploadId: 'upload-1' }),
    );
  });

  it('그림 생성이 null 이면 그림 없이 발행한다', async () => {
    const dependencies = makeConsumer({ notionDatabaseId: 'DATABASE' });
    dependencies.generateStudyDiagram.execute.mockResolvedValue(null);

    await dependencies.consumer.process(JOB as never);

    expect(dependencies.notionFileUpload.uploadImage).not.toHaveBeenCalled();
    expect(dependencies.studyBriefPublisher.publish).toHaveBeenCalledWith(
      expect.not.objectContaining({ diagramFileUploadId: expect.anything() }),
    );
  });

  it('업로드가 실패해도 페이지 발행과 Slack 발송은 그대로 진행한다', async () => {
    const dependencies = makeConsumer({ notionDatabaseId: 'DATABASE' });
    dependencies.generateStudyDiagram.execute.mockResolvedValue({
      png: Buffer.from('png'),
      html: '<html></html>',
      violations: [],
    });
    dependencies.notionFileUpload.uploadImage.mockRejectedValue(
      new Error('notion 500'),
    );

    await dependencies.consumer.process(JOB as never);

    expect(dependencies.studyBriefPublisher.publish).toHaveBeenCalled();
    expect(dependencies.slackNotifier.postMessage).toHaveBeenCalled();
  });

  it('그림 생성이 예외를 던져도 발행을 막지 않는다', async () => {
    const dependencies = makeConsumer({ notionDatabaseId: 'DATABASE' });
    dependencies.generateStudyDiagram.execute.mockRejectedValue(
      new Error('unexpected'),
    );

    await dependencies.consumer.process(JOB as never);

    expect(dependencies.studyBriefPublisher.publish).toHaveBeenCalled();
    expect(dependencies.slackNotifier.postMessage).toHaveBeenCalled();
  });

  it('Notion 발행 대상이 없으면 그림을 생성하지 않는다', async () => {
    const dependencies = makeConsumer();

    await dependencies.consumer.process(JOB as never);

    expect(dependencies.generateStudyDiagram.execute).not.toHaveBeenCalled();
  });

  it('그림 포함 발행이 실패하면 그림 없이 재발행해 페이지를 만든다', async () => {
    const dependencies = makeConsumer({ notionDatabaseId: 'DATABASE' });
    dependencies.generateStudyDiagram.execute.mockResolvedValue({
      png: Buffer.from('png'),
      html: '<html></html>',
      violations: [],
    });
    dependencies.notionFileUpload.uploadImage.mockResolvedValue('upload-1');
    dependencies.studyBriefPublisher.publish
      .mockRejectedValueOnce(new Error('image expired'))
      .mockResolvedValueOnce({
        pageId: 'PAGE',
        url: 'https://notion.so/PAGE',
      });
    const warn = jest
      .spyOn(dependencies.consumer['logger'], 'warn')
      .mockImplementation();

    try {
      await dependencies.consumer.process(JOB as never);

      expect(dependencies.studyBriefPublisher.publish).toHaveBeenCalledTimes(
        2,
      );
      expect(
        dependencies.studyBriefPublisher.publish.mock.calls[1][0],
      ).toEqual(
        expect.not.objectContaining({
          diagramFileUploadId: expect.anything(),
        }),
      );
      expect(
        dependencies.studyBriefRepository.updateNotionUrl,
      ).toHaveBeenCalledWith(7, 'https://notion.so/PAGE');
      expect(dependencies.slackNotifier.postMessage).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('그림 없이 재발행 성공'),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('그림 없는 재발행도 실패하면 null이 되어 Slack 전체 카드로 간다', async () => {
    const dependencies = makeConsumer({ notionDatabaseId: 'DATABASE' });
    dependencies.generateStudyDiagram.execute.mockResolvedValue({
      png: Buffer.from('png'),
      html: '<html></html>',
      violations: [],
    });
    dependencies.notionFileUpload.uploadImage.mockResolvedValue('upload-1');
    dependencies.studyBriefPublisher.publish
      .mockRejectedValueOnce(new Error('image expired'))
      .mockRejectedValueOnce(new Error('retry down'));
    const warn = jest
      .spyOn(dependencies.consumer['logger'], 'warn')
      .mockImplementation();

    try {
      await dependencies.consumer.process(JOB as never);

      expect(dependencies.studyBriefPublisher.publish).toHaveBeenCalledTimes(
        2,
      );
      expect(
        dependencies.studyBriefRepository.updateNotionUrl,
      ).not.toHaveBeenCalled();
      expect(dependencies.slackNotifier.postMessage).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('그림 없는 재발행도 실패'),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('그림이 없던 발행 실패는 재발행하지 않는다(publish 호출 1회)', async () => {
    const dependencies = makeConsumer({
      notionDatabaseId: 'DATABASE',
      notionError: new Error('notion down'),
    });

    await dependencies.consumer.process(JOB as never);

    expect(dependencies.studyBriefPublisher.publish).toHaveBeenCalledTimes(1);
  });
});
