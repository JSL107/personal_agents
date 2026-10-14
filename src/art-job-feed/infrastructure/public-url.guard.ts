import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

// 검색 결과의 임의 이미지 주소를 서버가 받으므로, 그 주소(와 리다이렉트 대상)가 내부망을
// 가리키면 내부 서비스를 호출하게 된다(SSRF). 공인 주소로만 나가게 막는다.
//
// 한계: 검사 뒤 fetch 가 DNS 를 다시 해석하므로 그 사이 응답을 바꾸는 DNS 리바인딩은 막지 못한다.
// 이 피드는 사람이 보는 그림 한 장을 받는 용도라 그 수준의 방어는 두지 않는다.

const PRIVATE_IPV4_RANGES: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

const ipv4ToNumber = (address: string): number => {
  return address
    .split('.')
    .reduce((total, part) => total * 256 + Number(part), 0);
};

const isPrivateIpv4 = (address: string): boolean => {
  const value = ipv4ToNumber(address);
  return PRIVATE_IPV4_RANGES.some(([base, bits]) => {
    const size = 2 ** (32 - bits);
    const start = ipv4ToNumber(base);
    return value >= start && value < start + size;
  });
};

const isPrivateIpv6 = (address: string): boolean => {
  const lower = address.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)?.[1];
  if (mapped) {
    return isPrivateIpv4(mapped);
  }
  return (
    lower === '::' ||
    lower === '::1' ||
    /^f[cd]/.test(lower) ||
    /^fe[89ab]/.test(lower) ||
    /^ff/.test(lower)
  );
};

export const isPublicAddress = (address: string): boolean => {
  const version = isIP(address);
  if (version === 4) {
    return !isPrivateIpv4(address);
  }
  if (version === 6) {
    return !isPrivateIpv6(address);
  }
  return false;
};

export const assertPublicUrl = async (url: URL): Promise<void> => {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`허용하지 않는 프로토콜: ${url.protocol}`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host)
    ? [host]
    : (await lookup(host, { all: true })).map((entry) => entry.address);
  if (addresses.length === 0 || !addresses.every(isPublicAddress)) {
    throw new Error(`내부망 주소로 가는 이미지 요청 차단: ${url.hostname}`);
  }
};
