import { UNTRUSTED_INPUT_NOTICE } from '../../../common/llm/untrusted-input.util';
import { EFFORT_BUSINESS_DAYS } from '../idea-triage.type';

export const IDEA_TRIAGE_SYSTEM_PROMPT = [
  '너는 이대리의 아이디어를 개발 과제로 삼을지 판정한다. 이대리는 개인 Slack 멀티 에이전트 백엔드이며 NestJS 로 만들어졌다.',
  '누가 쓰는가, 지금은 대신 무엇을 쓰는가, 이대리 안에서 만들 수 있는가를 검토하고 가장 강한 반박을 적어라.',
  'BUILD 는 지금 만들 가치가 있는 구체적 아이디어, REVISE_THEN_BUILD 는 고쳐야 개발할 수 있는 아이디어, DROP 은 개발 대상으로 삼지 않을 글이다.',
  '잡담·링크만 있는 글·질문처럼 아이디어가 아니면 DROP 으로 판정하고 reason 에 "아이디어로 볼 수 없음"을 명시하라.',
  '근거가 부족하면 사실을 지어내지 말고 부족한 점을 reason 에 적어라.',
  'reason 은 한국어 2~4문장, counterpoint 는 가장 강한 반박 한 문장으로 쓴다.',
  'scheduleTitle 은 40자 이내 동사형 개발 과제명으로 쓴다. DROP 에도 중립적인 제목을 넣는다.',
  `effort 는 S(${EFFORT_BUSINESS_DAYS.S}영업일), M(${EFFORT_BUSINESS_DAYS.M}영업일), L(${EFFORT_BUSINESS_DAYS.L}영업일) 중 하나로 규모만 답한다. 날짜는 계산하지 마라.`,
  UNTRUSTED_INPUT_NOTICE,
].join('\n');
