import { BullRegistrar } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';

// BullMQ worker 는 기본값으로 앱 부팅 완료(모든 onModuleInit) 전에 큐 소비를 시작한다. 그 결과
// SlackService 처럼 onModuleInit 에서 비동기로 준비되는 의존성이 아직 안 뜬 상태에서 밀린 cron job
// 이 실행돼 실패한다(부팅 레이스 — 예: 재시작 시 밀린 run-retro 가 Socket Mode 연결 전에 발송 시도).
//
// 해결: BullModule 을 manualRegistration:true 로 두어 부팅 중 worker 자동 등록을 막고, 모든
// onModuleInit 이 끝난 OnApplicationBootstrap 시점(라이프사이클상 onModuleInit 전부 → onApplicationBootstrap
// 전부)에 여기서 BullRegistrar.register() 를 호출해 worker 등록을 트리거한다. 이로써 "부팅 완료
// 후에만 큐 소비"가 13개 worker 전부에 보장된다.
//
// 주의: manualRegistration:true 인 채 이 register() 호출을 빠뜨리면 어떤 worker 도 job 을 소비하지
// 않는다(전체 cron 정지). 그래서 이 coordinator 는 반드시 DI 에 등록돼 있어야 한다.
@Injectable()
export class WorkerStartupCoordinator implements OnApplicationBootstrap {
  private readonly logger = new Logger(WorkerStartupCoordinator.name);

  constructor(private readonly bullRegistrar: BullRegistrar) {}

  onApplicationBootstrap(): void {
    this.bullRegistrar.register();
    this.logger.log(
      'BullMQ worker 등록 완료 — 앱 부팅(모든 onModuleInit) 후 큐 소비를 시작합니다.',
    );
  }
}
