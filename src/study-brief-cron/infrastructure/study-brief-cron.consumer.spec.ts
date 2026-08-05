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
}: {
  profile?: typeof PROFILE | null;
  hermesOutput?: string;
  hermesError?: Error;
  cronIdempotency?: ReturnType<typeof makeCronIdempotencyFake>;
} = {}) => {
  const evaluateStudyTopic = {
    execute: jest.fn().mockResolvedValue({
      result: {
        kind: 'CONCEPT',
        whyNow: '지금 필요',
        whereItLands: 'src/agent-run/',
        readingPlan: '공식 문서',
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
  };
  const installedTools = { collect: jest.fn().mockResolvedValue(['serena']) };
  const slackNotifier = {
    postMessage: jest.fn().mockResolvedValue({ ts: 'T1' }),
  };
  const notificationPublisher = { publishCronFailure: jest.fn() };
  const consumer = new StudyBriefCronConsumer(
    evaluateStudyTopic as never,
    profileRepository as never,
    hermesRunner as never,
    studyBriefRepository as never,
    installedTools as never,
    slackNotifier as never,
    cronIdempotency as never,
    notificationPublisher as never,
  );

  return {
    consumer,
    evaluateStudyTopic,
    profileRepository,
    hermesRunner,
    studyBriefRepository,
    installedTools,
    slackNotifier,
    notificationPublisher,
    cronIdempotency,
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
      expect.objectContaining({ profileSummary: PROFILE.profileJson.summary }),
    );
  });

  it('같은 날 두 번째 처리에서는 발송을 건너뛴다', async () => {
    const dependencies = makeConsumer();

    await dependencies.consumer.process(JOB as never);
    await dependencies.consumer.process(JOB as never);

    expect(dependencies.slackNotifier.postMessage).toHaveBeenCalledTimes(2);
    expect(dependencies.studyBriefRepository.save).toHaveBeenCalledTimes(1);
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
        /^cron:study-brief-cron:\d{4}-\d{2}-\d{2}:processing$/,
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
});
