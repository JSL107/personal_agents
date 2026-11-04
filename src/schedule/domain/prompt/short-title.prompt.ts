import { UNTRUSTED_INPUT_NOTICE } from '../../../common/llm/untrusted-input.util';

export const SHORT_TITLE_SYSTEM_PROMPT = `업무 제목을 의미가 보존되는 30자 이하의 간결한 한국어 이름으로 바꾸세요. 입력 번호를 유지하여 각 줄을 "번호. 이름" 형식으로만 출력하세요. 줄표와 내부 용어를 쓰지 마세요. ${UNTRUSTED_INPUT_NOTICE}`;
