import Foundation

// 실행형 테스트 엔트리포인트. 각 스위트를 순차 실행하고 실패를 모아 exit code 로 낸다.
// 실행: `swift run ConsoleCoreTests` — exit 0 = green.
let runner = TestRunner()

runCozyAgentAppearanceTests(runner)
runCozyPoseContractTests(runner)
runConsoleTimeTests(runner)
runAgentStatePaletteTests(runner)
runAgentRoleTests(runner)
runModelsTests(runner)
runConsoleStoreTests(runner)
runSessionStoreTests(runner)
runSSEParserTests(runner)
runDepartmentTests(runner)
runAgentTokenInfoTests(runner)
runPresidentBriefingTests(runner)
runMascotTests(runner)
runBriefingParityTests(runner)
runAgentLedgerTests(runner)
runConsoleClientTests(runner)
runConsoleFailureReasonTests(runner)
runCalendarGridTests(runner)
runCalendarDayListTests(runner)
runDeliveriesTests(runner)
runCalendarDayToneTests(runner)
runScheduleComposeTests(runner)
runScheduleLinkTests(runner)

runner.finish()
