import { ProfileAccomplishment } from './career-mate.type';

// 저장소 하나에 모인 성과 묶음. 사이트 프로젝트 1건이 이 묶음 1개에 대응한다.
//
// 성과는 PR 단위로 계속 쌓이므로(merge-accomplishment) 성과 1개 = 프로젝트 1개로 두면 같은
// 저장소의 작업이 수십 건으로 흩어지고, 제목도 서로 구분되지 않는다. 저장소를 경계로 묶어
// 개별 작업은 프로젝트 안의 "과정" 목록으로 내린다.
export interface ProjectGroup {
  // 사이트 slug 로 그대로 쓴다. 저장소가 같으면 회차가 달라도 같은 값이라 멱등 키가 된다.
  key: string;
  repo: string;
  anonymized: boolean;
  accomplishments: ProfileAccomplishment[];
  techStack: string[];
  period: string;
  links: Record<string, string>;
}

// 모델이 지어내는 프로젝트 이름·서술. 근거는 그룹에 속한 성과들뿐이다.
export interface ProjectGroupNaming {
  key: string;
  title: string;
  summary: string;
  problem: string;
  result: string;
}
