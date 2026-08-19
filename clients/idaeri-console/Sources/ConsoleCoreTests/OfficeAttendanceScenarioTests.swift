import Foundation

@testable import ConsoleCore

// 렌더 비교는 "안 그린 것"을 정상으로 본다. 출근 규칙이 통째로 빠져도 새벽 3시 화면은
// 원래 빈 사무실과 구분되지 않아 이미지 대조를 그대로 통과한다. 그래서 여기서는 그림이
// 아니라 시각별 착석 인원을 직접 세어 단언한다.
//
// 표본은 `OfficeFloorPlanTests`의 `sampleAgents`(운영 32명, 사규 부서 포함)를 그대로 쓴다.
// `OfficeIdleTests`가 같은 이유로 이미 이 표본을 공유한다 — 예전에 부서를 넘기지 않은
// 별도 표본을 쓰다가 전원이 기본 부서 한 곳으로 몰려, 방이 여섯일 때만 드러나는 결함을
// 통째로 놓친 이력이 있다. 표본을 또 갈라놓지 않는다.

func runOfficeAttendanceScenarioTests(_ t: TestRunner) {
    t.suite("OfficeAttendance 시나리오")

    // 실측 표본: 32명 중 6명만 오늘 처리 기록이 있다(2026-08-19 스냅샷).
    let doneToday: [String: Int] = [
        "PM": 1, "CODE_REVIEWER": 4, "SUBCONSCIOUS_GATE": 3,
        "HUMANIZER": 2, "INVEST": 1, "CTO_STUDY": 1,
    ]
    let allAgentTypes = sampleAgents.map(\.agentType)

    func seatedCount(hour: Int, activeRuns: Set<String> = []) -> Int {
        allAgentTypes.filter { agentType in
            officeAttendance(
                hour: hour,
                input: OfficeAttendanceInput(
                    hasActiveRun: activeRuns.contains(agentType),
                    doneToday: doneToday[agentType] ?? 0,
                    isQueued: false
                )
            ) == .present
        }.count
    }

    // 이 단언들이 잡는 회귀: 출근 규칙이 통째로 빠져 "아무도 안 그려지는" 상태.
    // 렌더 이미지 비교로는 빈 사무실이 밤 화면과 구분되지 않아 통과해 버린다.
    // 기대값은 표본 자체에서 유도한다(literal count 금지) — 표본이 바뀌면 기대값도 함께 바뀐다.
    t.expectEqual(seatedCount(hour: 3), 0, "새벽 3시, 도는 일이 없으면 아무도 없다")
    t.expectEqual(seatedCount(hour: 3, activeRuns: ["INVEST"]), 1, "새벽 3시 야근자 한 명")
    t.expectEqual(seatedCount(hour: 6), doneToday.count, "새벽 6시엔 조기 출근자만")
    t.expectEqual(seatedCount(hour: 13), allAgentTypes.count, "오후 1시엔 전원")
    t.expectEqual(seatedCount(hour: 20), allAgentTypes.count, "저녁 8시까지 전원")
    t.expectEqual(seatedCount(hour: 22), 0, "밤 10시엔 도는 일이 없으면 아무도 없다")
}
