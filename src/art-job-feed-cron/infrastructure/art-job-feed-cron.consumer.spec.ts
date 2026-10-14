import { exclusionKey } from '../../art-job-feed/domain/art-job-exclusion';
import {
  ArtJobListing,
  ArtJobListResult,
  ResolvedArtJobImage,
} from '../../art-job-feed/domain/art-job-feed.type';
import { ArtJobFeedCronConsumer } from './art-job-feed-cron.consumer';

const listing = (sourceId: string, title: string): ArtJobListing => ({
  sourceId,
  company: '회사',
  title,
  detailUrl: `https://www.gamejob.co.kr/Recruit/GI_Read/View?GI_No=${sourceId}`,
  deadlineText: null,
  career: null,
  employmentType: null,
  location: null,
});

const CHARACTER = (sourceId: string) =>
  listing(sourceId, '[카오스 제로 나이트메어] 캐릭터 원화');
const MODELER = listing('900', '[마비노기 모바일] 3D 캐릭터 모델러 모집');

const WITH_IMAGE: ResolvedArtJobImage = {
  gameTitle: '카오스 제로 나이트메어',
  image: { url: 'https://img.example/a.png', origin: 'PLAY_STORE' },
  googleSearchUrl: null,
};

const JOB = {
  data: { target: 'C1', mentionUserId: 'U9', ownerSlackUserId: 'U1' },
};

interface MakeOptions {
  pages?: ArtJobListResult[];
  known?: string[];
  excludedKeys?: string[];
  isEmpty?: boolean;
  resolved?: ResolvedArtJobImage;
  downloadFails?: boolean;
}

const makeConsumer = ({
  pages = [{ received: 0, listings: [] }],
  known = [],
  excludedKeys = [],
  isEmpty = false,
  resolved = WITH_IMAGE,
  downloadFails = false,
}: MakeOptions = {}) => {
  const source = {
    fetchLatest: jest.fn(async (page: number) => {
      return pages[page - 1] ?? { received: 0, listings: [] };
    }),
    fetchCompanyPhotoUrls: jest.fn(),
  };
  const imageResolver = { resolve: jest.fn().mockResolvedValue(resolved) };
  const imageDownloader = {
    download: downloadFails
      ? jest.fn().mockRejectedValue(new Error('timeout'))
      : jest
          .fn()
          .mockResolvedValue({ buffer: Buffer.from('x'), filename: 'a.png' }),
  };
  const repository = {
    isEmpty: jest.fn().mockResolvedValue(isEmpty),
    findKnownSourceIds: jest.fn().mockResolvedValue(new Set(known)),
    markNotified: jest.fn().mockResolvedValue(undefined),
    markSeeded: jest.fn().mockResolvedValue(undefined),
    findExcludedKeys: jest.fn().mockResolvedValue(new Set(excludedKeys)),
  };
  const slackNotifier = {
    postMessage: jest.fn().mockResolvedValue({ ts: '1' }),
    uploadImageFile: jest.fn().mockResolvedValue({ fileId: 'F1' }),
  };
  // 실제 가드처럼 키를 기억한다 — 항상 true 면 키 구성의 결함을 못 잡는다.
  const acquired = new Set<string>();
  const cronIdempotency = {
    acquireOnce: jest.fn(async (key: string) => {
      if (acquired.has(key)) {
        return false;
      }
      acquired.add(key);
      return true;
    }),
    release: jest.fn(async (key: string) => {
      acquired.delete(key);
    }),
  };
  const notificationPublisher = {
    publishCronFailure: jest.fn(),
    publishRecovery: jest.fn(),
  };
  const consumer = new ArtJobFeedCronConsumer(
    source as never,
    imageResolver as never,
    imageDownloader as never,
    repository as never,
    slackNotifier as never,
    cronIdempotency as never,
    notificationPublisher as never,
  );
  return {
    consumer,
    source,
    repository,
    slackNotifier,
    notificationPublisher,
  };
};

describe('ArtJobFeedCronConsumer', () => {
  it('대상 직무의 신규 공고를 본문 1통으로 보내고 이미지는 그 스레드에 단다', async () => {
    const { consumer, slackNotifier, repository } = makeConsumer({
      pages: [
        { received: 3, listings: [CHARACTER('1'), MODELER, CHARACTER('2')] },
      ],
      known: ['2'],
    });

    await consumer.process(JOB as never);

    expect(slackNotifier.postMessage).toHaveBeenCalledTimes(2);
    const [main] = slackNotifier.postMessage.mock.calls[0];
    expect(main).toMatchObject({
      target: 'C1',
      kind: 'art-job-feed',
      unfurlLinks: false,
    });
    expect(main.text.startsWith('🎨 <@U9> 게임잡 새 원화 공고 *1건*')).toBe(
      true,
    );
    expect(main.text).toContain('GI_No=1|');
    expect(main.text).not.toContain('GI_No=900');
    expect(slackNotifier.postMessage.mock.calls[1][0]).toMatchObject({
      threadTs: '1',
      text: '1. 🎮 카오스 제로 나이트메어',
      image: { fileId: 'F1', altText: '카오스 제로 나이트메어' },
    });
    expect(repository.markNotified).toHaveBeenCalledTimes(1);
    expect(repository.markNotified.mock.calls[0][0]).toMatchObject({
      messageTs: '1',
      digestOrder: 1,
    });
    expect(repository.markSeeded).not.toHaveBeenCalled();
  });

  it('번호 이모지로 제외한 공고가 새 번호로 다시 올라오면 보내지 않는다', async () => {
    const { consumer, slackNotifier, repository } = makeConsumer({
      pages: [
        {
          received: 2,
          listings: [
            CHARACTER('7'),
            listing('8', '[카오스 제로 나이트메어] 일러스트'),
          ],
        },
      ],
      excludedKeys: [
        exclusionKey('회사', '[카오스 제로 나이트메어]  캐릭터 원화'),
      ],
    });

    await consumer.process(JOB as never);

    const [main] = slackNotifier.postMessage.mock.calls[0];
    expect(main.text).toContain('*1건*');
    expect(main.text).toContain('GI_No=8|');
    expect(main.text).not.toContain('GI_No=7|');
    expect(repository.markNotified).toHaveBeenCalledTimes(1);
  });

  it('신규가 없으면 아무것도 보내지 않는다', async () => {
    const { consumer, slackNotifier } = makeConsumer({
      pages: [{ received: 1, listings: [CHARACTER('1')] }],
      known: ['1'],
    });
    await consumer.process(JOB as never);
    expect(slackNotifier.postMessage).not.toHaveBeenCalled();
  });

  it('첫 실행은 상한(10건)만 게시하고 나머지는 SEED 로 표시한다', async () => {
    const many = Array.from({ length: 13 }, (_, index) => {
      return CHARACTER(String(index + 1));
    });
    const { consumer, slackNotifier, repository } = makeConsumer({
      pages: [{ received: 13, listings: many }],
      isEmpty: true,
    });

    await consumer.process(JOB as never);

    // 본문 1통 + 이미지 스레드 10통
    expect(slackNotifier.postMessage).toHaveBeenCalledTimes(11);
    expect(slackNotifier.postMessage.mock.calls[0][0].text).toContain('*10건*');
    expect(repository.markNotified).toHaveBeenCalledTimes(10);
    expect(
      repository.markSeeded.mock.calls[0][0].map(
        (item: ArtJobListing) => item.sourceId,
      ),
    ).toEqual(['11', '12', '13']);
  });

  it('이미지 다운로드가 실패해도 본문은 나가고 장부에 남는다', async () => {
    const { consumer, slackNotifier, repository } = makeConsumer({
      pages: [{ received: 1, listings: [CHARACTER('1')] }],
      downloadFails: true,
    });
    await consumer.process(JOB as never);
    expect(slackNotifier.postMessage).toHaveBeenCalledTimes(1);
    expect(repository.markNotified).toHaveBeenCalledTimes(1);
  });

  it('이미지가 없는 공고는 스레드를 달지 않는다', async () => {
    const { consumer, slackNotifier } = makeConsumer({
      pages: [{ received: 1, listings: [CHARACTER('1')] }],
      resolved: {
        gameTitle: '카오스 제로 나이트메어',
        image: null,
        googleSearchUrl: 'https://www.google.com/search?tbm=isch&q=x',
      },
    });
    await consumer.process(JOB as never);
    expect(slackNotifier.postMessage).toHaveBeenCalledTimes(1);
  });

  it('행을 받았는데 파싱이 0 이면 실패로 던지고 owner 에게 알린다', async () => {
    const { consumer, slackNotifier, notificationPublisher } = makeConsumer({
      pages: [{ received: 40, listings: [] }],
    });
    await expect(consumer.process(JOB as never)).rejects.toThrow(
      '마크업 변경 의심',
    );
    expect(slackNotifier.postMessage).not.toHaveBeenCalled();
    expect(notificationPublisher.publishCronFailure).toHaveBeenCalledWith(
      expect.objectContaining({ ownerSlackUserId: 'U1' }),
    );
  });

  it('두 쪽에 같은 공고가 걸쳐 나오면 한 번만 게시한다', async () => {
    const { consumer, slackNotifier } = makeConsumer({
      pages: [
        { received: 1, listings: [CHARACTER('1')] },
        { received: 1, listings: [CHARACTER('1')] },
      ],
    });
    await consumer.process(JOB as never);
    expect(slackNotifier.postMessage).toHaveBeenCalledTimes(2);
  });

  it('본문 발송이 실패하면 슬롯 가드를 풀어 재시도가 실제로 다시 보낸다', async () => {
    const { consumer, slackNotifier, repository } = makeConsumer({
      pages: [{ received: 1, listings: [CHARACTER('1')] }],
    });
    slackNotifier.postMessage.mockRejectedValueOnce(new Error('rate_limited'));

    await expect(consumer.process(JOB as never)).rejects.toThrow(
      'rate_limited',
    );
    expect(repository.markNotified).not.toHaveBeenCalled();

    await consumer.process(JOB as never);
    // 실패한 1회 + 재시도 본문 1통 + 스레드 이미지 1통
    expect(slackNotifier.postMessage).toHaveBeenCalledTimes(3);
    expect(repository.markNotified).toHaveBeenCalledTimes(1);
  });

  it('같은 슬롯의 재처리는 발송하지 않는다', async () => {
    const { consumer, slackNotifier } = makeConsumer({
      pages: [{ received: 1, listings: [CHARACTER('1')] }],
    });
    await consumer.process(JOB as never);
    await consumer.process(JOB as never);
    expect(slackNotifier.postMessage).toHaveBeenCalledTimes(2);
  });
});
