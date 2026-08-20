import Foundation

// 실행형 테스트 엔트리포인트. 각 스위트를 순차 실행하고 실패를 모아 exit code 로 낸다.
// 실행: `swift run ConsoleCoreTests` — exit 0 = green.
let runner = TestRunner()

runModelsTests(runner)
runConsoleStoreTests(runner)
runSessionStoreTests(runner)
runSSEParserTests(runner)
runOfficeLayoutTests(runner)
runOfficeChoreographyTests(runner)
runOfficeInteractionTests(runner)
runDepartmentTests(runner)
runAgentTokenInfoTests(runner)
runOfficeRoomLayoutTests(runner)
runOfficeFloorPlanTests(runner)
runOfficeNameplateFitTests(runner)
runOfficeLabelOverlapTests(runner)
runAgentRoleTests(runner)
runOfficePathfindingTests(runner)
runOfficeIdleTests(runner)
runOfficeAttendanceTests(runner)
runOfficeAttendanceScenarioTests(runner)
runOfficeApprovalPressureTests(runner)
runOfficeAccessibilityTests(runner)
runOfficeWhiteboardTests(runner)
runConsoleClientTests(runner)

runner.finish()
