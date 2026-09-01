import { isBlockedAddress, resolveHostPolicy } from './crawl-target.policy';

describe('isBlockedAddress', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['10.0.0.5', '사설 10/8'],
    ['172.16.0.1', '사설 172.16/12'],
    ['172.31.255.254', '사설 172.16/12 끝'],
    ['192.168.0.1', '사설 192.168/16'],
    ['169.254.169.254', '클라우드 메타데이터'],
    ['100.101.102.103', 'Tailscale CGNAT'],
    ['0.0.0.0', 'this-network'],
    ['224.0.0.1', '멀티캐스트'],
    ['::1', 'IPv6 loopback'],
    ['fd00::1', 'IPv6 ULA'],
    ['fe80::1', 'IPv6 link-local'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
    // URL 정규화를 거치면 점 표기가 헥사로 바뀐다(`::ffff:127.0.0.1` → `::ffff:7f00:1`).
    // 손으로 만든 점 표기 정규식이 여기서 뚫렸다 — 회귀로 남긴다.
    ['::ffff:7f00:1', 'IPv4-mapped loopback(헥사 표기)'],
    ['::ffff:c0a8:1', 'IPv4-mapped 사설(헥사 표기)'],
    ['127.0.0.2', 'loopback 대역 전체'],
    ['not-an-ip', 'IP 로 파싱되지 않음'],
  ])('%s 를 막는다 (%s)', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  // 대조군 — 막기만 하고 통과가 없으면 "전부 차단" 도 초록으로 보인다.
  it.each([
    ['93.184.215.14', '공인 IPv4'],
    ['8.8.8.8', '공인 DNS'],
    ['172.32.0.1', '172.16/12 바로 바깥'],
    ['100.63.255.255', 'CGNAT 바로 앞'],
    ['100.128.0.1', 'CGNAT 바로 뒤'],
    ['2606:4700:4700::1111', '공인 IPv6'],
  ])('%s 는 통과시킨다 (%s)', (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });
});

describe('resolveHostPolicy', () => {
  const resolverReturning = (...addresses: string[]) =>
    jest.fn(async () => addresses.map((address) => ({ address }))) as never;

  it('IP 리터럴은 DNS 를 타지 않고 그대로 판정한다', async () => {
    const resolver = jest.fn();
    await expect(
      resolveHostPolicy('192.168.0.1', resolver as never),
    ).resolves.toEqual({ kind: 'BLOCKED', address: '192.168.0.1' });
    expect(resolver).not.toHaveBeenCalled();
  });

  it('대괄호로 감싼 IPv6 리터럴도 판정한다', async () => {
    await expect(
      resolveHostPolicy('[::1]', jest.fn() as never),
    ).resolves.toEqual({ kind: 'BLOCKED', address: '::1' });
  });

  it('공인 주소로 풀리면 통과한다', async () => {
    await expect(
      resolveHostPolicy('example.com', resolverReturning('93.184.215.14')),
    ).resolves.toEqual({ kind: 'ALLOWED' });
  });

  it('여러 레코드 중 하나만 내부여도 막는다', async () => {
    await expect(
      resolveHostPolicy(
        'mixed.example.com',
        resolverReturning('93.184.215.14', '10.0.0.5'),
      ),
    ).resolves.toEqual({ kind: 'BLOCKED', address: '10.0.0.5' });
  });

  it('이름을 못 풀면 UNRESOLVED', async () => {
    const failing = jest.fn(async () => {
      throw new Error('ENOTFOUND');
    });
    await expect(
      resolveHostPolicy('nope.example.com', failing as never),
    ).resolves.toEqual({ kind: 'UNRESOLVED' });
  });

  it('레코드가 비어도 UNRESOLVED', async () => {
    await expect(
      resolveHostPolicy('empty.example.com', resolverReturning()),
    ).resolves.toEqual({ kind: 'UNRESOLVED' });
  });
});
