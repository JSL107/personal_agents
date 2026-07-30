import Foundation

@testable import ConsoleCore

/// 부서 매핑·부서 팔레트(순수)의 검증.
func runDepartmentTests(_ t: TestRunner) {
    t.suite("Department")

    // 26개 실제 agentType 이 기대 부서로 매핑됨
    let planning = ["PM", "PO_SHADOW", "PO_EVAL"]
    let engineering = ["BE", "BE_SCHEMA", "BE_TEST", "BE_SRE", "BE_FIX"]
    let review = ["CODE_REVIEWER", "WORK_REVIEWER", "IMPACT_REPORTER"]
    let executive = ["CTO", "CEO"]
    let growth = ["CAREER_MATE", "JOB_APPLICATION", "BLOG", "VACATION"]
    let internalOps = [
        "ISSUE_LABELER", "SUBCONSCIOUS_GATE", "CONTRADICTION_JUDGE", "HUMANIZER",
        "DOCS_AUDIT_OPTIMIZER", "DOCS_AUDIT_EVALUATOR", "PREFERENCE_LEARNING",
        "EVENING_RETRO", "OPS_SUPERVISOR",
    ]
    for agentType in planning { t.expectEqual(department(for: agentType), .planning, "\(agentType) → 기획") }
    for agentType in engineering { t.expectEqual(department(for: agentType), .engineering, "\(agentType) → 개발") }
    for agentType in review { t.expectEqual(department(for: agentType), .review, "\(agentType) → 리뷰") }
    for agentType in executive { t.expectEqual(department(for: agentType), .executive, "\(agentType) → 경영") }
    for agentType in growth { t.expectEqual(department(for: agentType), .growth, "\(agentType) → 성장") }
    for agentType in internalOps { t.expectEqual(department(for: agentType), .internalOps, "\(agentType) → 내부") }

    let total = planning.count + engineering.count + review.count
        + executive.count + growth.count + internalOps.count
    t.expectEqual(total, 26, "매핑 커버 26개")

    // 미지 타입 → 내부 폴백(크래시 없이 흡수)
    t.expectEqual(department(for: "UNKNOWN_FUTURE"), .internalOps, "미지 타입 → 내부 폴백")
    t.expectEqual(department(for: ""), .internalOps, "빈 문자열 → 내부 폴백")

    // 팔레트: 6종 모두 0~1 범위, 서로 다른 색
    var seen = Set<String>()
    for dept in Department.allCases {
        let rgb = agentDepartmentPaletteRGBA(dept)
        let inRange = (0...1).contains(rgb.red) && (0...1).contains(rgb.green) && (0...1).contains(rgb.blue)
        t.expect(inRange, "\(dept) RGB 는 0~1 범위")
        seen.insert("\(rgb.red),\(rgb.green),\(rgb.blue)")
    }
    t.expectEqual(seen.count, 6, "부서 6색이 서로 다름")
    t.expectEqual(Department.allCases.count, 6, "부서 6종")

    // label 은 6종 모두 비어있지 않고 서로 다름
    let labels = Set(Department.allCases.map { $0.label })
    t.expectEqual(labels.count, 6, "부서 라벨 6종 서로 다름")
    t.expect(Department.allCases.allSatisfy { !$0.label.isEmpty }, "모든 부서 라벨 비어있지 않음")
}
