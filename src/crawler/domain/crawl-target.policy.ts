import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

// 크롤 대상 주소가 "바깥 인터넷" 인지 판정한다.
//
// 크롤러는 호출자가 준 주소를 헤드리스 브라우저로 그대로 방문한다. 대상을 막지 않으면
// 이 프로세스가 내부망을 대신 두드려 주는 도구가 된다(SSRF) — 백엔드 자신(127.0.0.1),
// 공유기 관리 화면(192.168.x.x), 클라우드 메타데이터(169.254.169.254) 처럼 바깥에서는
// 닿지 않는 주소가 대상이다.
//
// 판정은 손으로 만들지 않고 `net.BlockList` 에 맡긴다. 직접 문자열을 뜯으면 같은 주소의
// 다른 표기에서 구멍이 난다 — 실제로 `::ffff:127.0.0.1` 은 URL 정규화를 거치면
// `::ffff:7f00:1` 이 되어 점 표기를 기대한 검사를 그대로 지나간다. BlockList 는 두 표기를
// 모두 같은 IPv4 로 보고 CIDR 로 대조한다.

const BLOCKED_IPV4_SUBNETS: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8], // this-network
  ['10.0.0.0', 8], // 사설
  ['100.64.0.0', 10], // CGNAT — Tailscale 대역이 여기다
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local — 169.254.169.254(클라우드 메타데이터) 포함
  ['172.16.0.0', 12], // 사설
  ['192.168.0.0', 16], // 사설
  ['198.18.0.0', 15], // 벤치마킹 전용 — 내부에서 실제로 쓰이는 곳이 있다
  ['224.0.0.0', 4], // 멀티캐스트
  ['240.0.0.0', 4], // 예약
];

const BLOCKED_IPV6_SUBNETS: ReadonlyArray<readonly [string, number]> = [
  ['fc00::', 7], // ULA
  ['fe80::', 10], // link-local
  ['fec0::', 10], // 구 site-local (deprecated 이지만 아직 쓰는 내부망이 있다)
  ['ff00::', 8], // 멀티캐스트 — IPv4 의 224/4 에 대응한다
];

const buildBlockList = (): BlockList => {
  const list = new BlockList();
  for (const [network, prefix] of BLOCKED_IPV4_SUBNETS) {
    list.addSubnet(network, prefix, 'ipv4');
  }
  for (const [network, prefix] of BLOCKED_IPV6_SUBNETS) {
    list.addSubnet(network, prefix, 'ipv6');
  }
  list.addAddress('::1', 'ipv6');
  list.addAddress('::', 'ipv6');
  return list;
};

const blockList = buildBlockList();

export const isBlockedAddress = (ip: string): boolean => {
  const version = isIP(ip);
  if (version === 0) {
    // IP 로 파싱되지 않는 값은 판정할 수 없으므로 막는다.
    return true;
  }
  return blockList.check(ip, version === 4 ? 'ipv4' : 'ipv6');
};

export type HostResolution =
  | { readonly kind: 'ALLOWED' }
  | { readonly kind: 'BLOCKED'; readonly address: string }
  | { readonly kind: 'UNRESOLVED' };

// 호스트가 IP 리터럴이면 그대로, 이름이면 DNS 를 해석해 **모든** 레코드를 검사한다.
// 하나라도 내부 주소로 풀리면 막는다 — 여러 A 레코드 중 하나만 사설이어도 그쪽으로 붙을 수 있다.
//
// ponytail: DNS 를 한 번 해석해 판정하므로, 판정 직후 같은 이름이 다른 IP 로 재해석되는
// rebinding 까지는 막지 못한다. 그 경로까지 막아야 하면 접속 IP 를 고정하거나 크롤러를
// 송신 제한된 별도 네트워크에 격리하는 쪽으로 올린다.
export const resolveHostPolicy = async (
  hostname: string,
  resolver: typeof lookup = lookup,
): Promise<HostResolution> => {
  // URL 이 `[::1]` 처럼 대괄호로 감싼 IPv6 를 주므로 벗겨 낸다.
  const bare = hostname.replace(/^\[|\]$/g, '');
  if (isIP(bare) !== 0) {
    return isBlockedAddress(bare)
      ? { kind: 'BLOCKED', address: bare }
      : { kind: 'ALLOWED' };
  }

  let records: Array<{ address: string }>;
  try {
    records = await resolver(bare, { all: true });
  } catch {
    return { kind: 'UNRESOLVED' };
  }
  if (records.length === 0) {
    return { kind: 'UNRESOLVED' };
  }
  const blocked = records.find((record) => isBlockedAddress(record.address));
  if (blocked) {
    return { kind: 'BLOCKED', address: blocked.address };
  }
  return { kind: 'ALLOWED' };
};
