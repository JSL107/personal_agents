import { Controller, MessageEvent, Sse, UseGuards } from '@nestjs/common';
import { map, Observable } from 'rxjs';

import { RawResponse } from '../../common/decorator/raw-response.decorator';
import { ConsoleEventBus } from '../application/console-event-bus.service';
import { ConsoleReadGuard } from './console-read.guard';

// 콘솔 관제 실시간 스트림 — 앱이 부팅 스냅샷 이후 구독하는 SSE 이벤트 소스.
//
// 스냅샷과 같은 가드를 쓴다 — 이쪽이 오히려 더 민감하다. `command.answered` 이벤트에
// 워커 산출물 전문이 실려 나가고, 한 번 붙은 구독은 계속 흘려받는다.
@Controller('v1/console')
@UseGuards(ConsoleReadGuard)
export class ConsoleStreamController {
  constructor(private readonly bus: ConsoleEventBus) {}

  // @RawResponse: ResponseInterceptor 의 {code,message,data} 래핑을 건너뛴다(SSE 포맷 보존).
  // 각 ConsoleEvent 를 MessageEvent.data 로 감싸면 NestJS 가 `data: <json>\n\n` 으로 직렬화한다.
  @Sse('stream')
  @RawResponse()
  stream(): Observable<MessageEvent> {
    return this.bus.stream().pipe(map((event) => ({ data: event })));
  }
}
