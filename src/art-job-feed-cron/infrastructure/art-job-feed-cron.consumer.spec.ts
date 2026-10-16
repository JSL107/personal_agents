import { exclusionKey } from '../../art-job-feed/domain/art-job-exclusion';
import {
  ArtJobListing,
  ArtJobListResult,
  ResolvedArtJobImage,
} from '../../art-job-feed/domain/art-job-feed.type';
import {
  ART_JOB_KEYWORD_SEED,
  ArtJobKeywordSet,
} from '../../art-job-feed/domain/art-job-keyword';
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
  id: 'cron-1',
  data: { target: 'C1', mentionUserId: 'U9', ownerSlackUserId: 'U1' },
};

interface MakeOptions {
  pages?: ArtJobListResult[];
  known?: string[];
  excludedKeys?: string[];
  isEmpty?: boolean;
  resolved?: ResolvedArtJobImage;
  downloadFails?: boolean;
  body?: string;
  bodyFails?: boolean;
  keywords?: ArtJobKeywordSet;
}

const makeConsumer = ({
  pages = [{ received: 0, listings: [] }],
  known = [],
  excludedKeys = [],
  isEmpty = false,
  resolved = WITH_IMAGE,
  downloadFails = false,
  body = '',
  bodyFails = false,
  keywords = ART_JOB_KEYWORD_SEED,
}: MakeOptions = {}) => {
  const source = {
    fetchLatest: jest.fn(async (page: number) => {
      return pages[page - 1] ?? { received: 0, listings: [] };
    }),
    fetchPostingBody: bodyFails
      ? jest.fn().mockRejectedValue(new Error('body timeout'))
      : jest.fn().mockResolvedValue(body),
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
  const keywordRepository = { load: jest.fn().mockResolvedValue(keywords) };
  const consumer = new ArtJobFeedCronConsumer(
    source as never,
    imageResolver as never,
    imageDownloader as never,
    repository as never,
    slackNotifier as never,
    cronIdempotency as never,
    keywordRepository as never,
    notificationPublisher as never,
  );
  return {
    consumer,
    source,
    repository,
    slackNotifier,
    notificationPublisher,
    keywordRepository,
    cronIdempotency,
  };
};

describe('ArtJobFeedCronConsumer', () => {
  it('키워드를 회차당 한 번 읽어 제목을 거르고 본문 화풍을 태그한다', async () => {
    const { consumer, slackNotifier, source, keywordRepository } = makeConsumer(
      {
        pages: [
          { received: 2, listings: [CHARACTER('1'), listing('2', '개발자')] },
        ],
        body: '북미풍 캐주얼',
      },
    );
    await expect(consumer.process(JOB as never)).resolves.toEqual({
      kind: 'POSTED',
      count: 1,
    });
    expect(keywordRepository.load).toHaveBeenCalledTimes(1);
    expect(source.fetchPostingBody).toHaveBeenCalledTimes(1);
    expect(slackNotifier.postMessage.mock.calls[0][0].text).toContain(
      '🎨 북미풍, 캐주얼',
    );
  });

  // 상세 페이지의 영문 장르 표기가 Slack 출력까지 이어지는지 — 한글 본문만으로는 함수 연결이 틀려도 통과한다(#851 리뷰).
  it('본문·상세 항목의 영문 장르(Casual)도 등록한 표기로 태그한다', async () => {
    const { consumer, slackNotifier } = makeConsumer({
      pages: [{ received: 1, listings: [CHARACTER('1')] }],
      body: '배경 원화\n게임분야: 모바일게임 RPG, Casual',
    });
    await consumer.process(JOB as never);
    const text: string = slackNotifier.postMessage.mock.calls[0][0].text;
    expect(text).toContain('🎨 캐주얼');
    expect(text).not.toContain('북미풍');
  });

  it('본문 조회 실패는 태그만 생략하고 게시를 계속한다', async () => {
    const { consumer, slackNotifier, repository } = makeConsumer({
      pages: [{ received: 1, listings: [CHARACTER('1')] }],
      bodyFails: true,
    });
    await expect(consumer.process(JOB as never)).resolves.toEqual({
      kind: 'POSTED',
      count: 1,
    });
    expect(slackNotifier.postMessage).toHaveBeenCalled();
    expect(repository.markNotified).toHaveBeenCalledTimes(1);
  });

  it('수동 슬롯은 cron 과 별개이며 같은 수동 job 재시도만 차단한다', async () => {
    const { consumer, cronIdempotency } = makeConsumer({
      pages: [{ received: 1, listings: [CHARACTER('1')] }],
    });
    const manual = {
      ...JOB,
      id: 'manual-7',
      data: { ...JOB.data, trigger: 'MANUAL' },
    };
    await expect(consumer.process(JOB as never)).resolves.toEqual({
      kind: 'POSTED',
      count: 1,
    });
    await expect(consumer.process(manual as never)).resolves.toEqual({
      kind: 'POSTED',
      count: 1,
    });
    await expect(consumer.process(manual as never)).resolves.toEqual({
      kind: 'SLOT_TAKEN',
    });
    expect(cronIdempotency.acquireOnce.mock.calls[1][0]).toBe(
      'cron:art-job-feed-cron:C1:manual:manual-7',
    );
  });
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
    expect(JSON.stringify(main.blocks)).toContain('GI_No=1|');
    expect(JSON.stringify(main.blocks)).not.toContain('GI_No=900');
    expect(slackNotifier.postMessage.mock.calls[1][0]).toMatchObject({
      threadTs: '1',
      text: '1. 🎮 카오스 제로 나이트메어',
      image: { fileId: 'F1', altText: '카오스 제로 나이트메어' },
    });
    expect(repository.markNotified).toHaveBeenCalledTimes(1);
    // 마감 전날 알림이 장부의 마감일을 읽는다 — 게시 라벨과 같은 규칙으로 계산해 함께 남긴다.
    expect(repository.markNotified.mock.calls[0][0]).toHaveProperty(
      'deadlineDate',
    );
    expect(repository.markSeeded).not.toHaveBeenCalled();
  });

  it('「관심 없음」으로 제외한 공고가 새 번호로 다시 올라오면 보내지 않는다', async () => {
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
    expect(JSON.stringify(main.blocks)).toContain('GI_No=8|');
    expect(JSON.stringify(main.blocks)).not.toContain('GI_No=7|');
    expect(repository.markNotified).toHaveBeenCalledTimes(1);
  });

  it('신규가 없으면 아무것도 보내지 않는다', async () => {
    const { consumer, slackNotifier } = makeConsumer({
      pages: [{ received: 1, listings: [CHARACTER('1')] }],
      known: ['1'],
    });
    await expect(consumer.process(JOB as never)).resolves.toEqual({
      kind: 'NO_NEW',
    });
    expect(slackNotifier.postMessage).not.toHaveBeenCalled();
  });

  // 2026-10-16: 앞 2쪽만 읽어 기능 개시 전 공고 67건이 한 번도 안 나갔다.
  it('목록을 빈 쪽이 나올 때까지 끝까지 읽는다', async () => {
    const { consumer, source, repository } = makeConsumer({
      pages: [
        { received: 1, listings: [CHARACTER('3')] },
        { received: 1, listings: [CHARACTER('2')] },
        { received: 1, listings: [CHARACTER('1')] },
      ],
    });

    await consumer.process(JOB as never);

    // 3쪽 + 빈 4쪽에서 멈춘다
    expect(source.fetchLatest).toHaveBeenCalledTimes(4);
    expect(repository.markNotified).toHaveBeenCalledTimes(3);
  });

  it('이미 본 공고만 되풀이하는 쪽에서 멈춘다', async () => {
    const repeated = { received: 1, listings: [CHARACTER('1')] };
    const { consumer, source } = makeConsumer({
      pages: Array.from({ length: 10 }, () => repeated),
    });

    await consumer.process(JOB as never);

    expect(source.fetchLatest).toHaveBeenCalledTimes(2);
  });

  it('상한은 최신 공고가 먼저 채우고 남는 자리에 밀린 공고가 들어간다', async () => {
    const page = (from: number) => ({
      received: 6,
      listings: Array.from({ length: 6 }, (_, index) => {
        return CHARACTER(String(from - index));
      }),
    });
    const { consumer, repository } = makeConsumer({
      pages: [page(100), page(94)],
    });

    await consumer.process(JOB as never);

    expect(
      repository.markNotified.mock.calls.map(
        ([input]: [{ listing: ArtJobListing }]) => input.listing.sourceId,
      ),
    ).toEqual(['100', '99', '98', '97', '96', '95', '94', '93', '92', '91']);
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

  it('회사 대표작 그림은 캡션에 대표작임을 밝혀 스레드에 단다', async () => {
    const { consumer, slackNotifier } = makeConsumer({
      pages: [{ received: 1, listings: [CHARACTER('1')] }],
      resolved: {
        gameTitle: null,
        image: { url: 'https://img.example/cat.png', origin: 'PLAY_STORE' },
        representativeGame: '캣히어로',
        googleSearchUrl: null,
      },
    });
    await consumer.process(JOB as never);
    expect(slackNotifier.postMessage.mock.calls[1][0]).toMatchObject({
      threadTs: '1',
      text: '1. 🎮 회사 대표작: 캣히어로',
      image: { fileId: 'F1', altText: '캣히어로' },
    });
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
