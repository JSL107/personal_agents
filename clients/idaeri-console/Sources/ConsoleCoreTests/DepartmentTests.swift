import Foundation

@testable import ConsoleCore

/// 부서 값 변환·부서 팔레트(순수)의 검증.
///
/// 예전에는 이 파일이 "agentType 26종이 어느 부서인가" 를 고정했다. 그 매핑은 백엔드 사규로
/// 넘어갔으므로(앱은 값을 옮겨 담을 뿐) 여기서 검증할 것은 **변환과 폴백**이다. 편성 자체는
/// `agent-registry` 의 소관이고, 앱 테스트가 그것을 다시 고정하면 정본이 둘로 돌아간다.
func runDepartmentTests(_ t: TestRunner) {
    t.suite("Department")

    // 백엔드가 보내는 rawValue 6종이 전부 앱 enum 으로 옮겨진다.
    // 문자열이 어긋나면 전원이 폴백으로 몰리므로, 왕복(enum → raw → enum)으로 못 박는다.
    for department in Department.allCases {
        t.expectEqual(
            departmentFromRaw(department.rawValue), department,
            "\(department.rawValue) 왕복 변환"
        )
    }

    // 백엔드 계약(`Department` enum)이 쓰는 실제 문자열. 한쪽만 이름을 바꾸면 여기서 걸린다.
    t.expectEqual(departmentFromRaw("planning"), .planning, "planning")
    t.expectEqual(departmentFromRaw("engineering"), .engineering, "engineering")
    t.expectEqual(departmentFromRaw("review"), .review, "review")
    t.expectEqual(departmentFromRaw("executive"), .executive, "executive")
    t.expectEqual(departmentFromRaw("growth"), .growth, "growth")
    t.expectEqual(departmentFromRaw("internalOps"), .internalOps, "internalOps")

    // 값이 없거나 앱이 모르는 부서 → 내부 폴백(크래시 없이 흡수).
    t.expectEqual(departmentFromRaw(nil), .internalOps, "nil → 내부 폴백")
    t.expectEqual(departmentFromRaw(""), .internalOps, "빈 문자열 → 내부 폴백")
    t.expectEqual(departmentFromRaw("FUTURE_DEPT"), .internalOps, "미지 부서 → 내부 폴백")
    // 대소문자·표기 차이도 폴백이다 — 백엔드가 SCREAMING_CASE 로 바꾸면 조용히 통과하지 않는다.
    t.expectEqual(departmentFromRaw("PLANNING"), .internalOps, "대문자 표기 → 폴백(관용 파싱 안 함)")

    // 에이전트가 들고 온 값이 그대로 화면 부서가 된다.
    let agent = ConsoleAgent(
        agentType: "REVIEW_REPLY_JUDGE", displayName: "Review Reply Judge", slashCommands: [],
        description: "", state: .waiting, bubble: "", department: Department.review.rawValue
    )
    t.expectEqual(agent.resolvedDepartment, .review, "스냅샷 값이 화면 부서로 쓰인다")
    let noDepartment = ConsoleAgent(
        agentType: "PM", displayName: "PM", slashCommands: [],
        description: "", state: .waiting, bubble: ""
    )
    t.expectEqual(noDepartment.resolvedDepartment, .internalOps, "부서 없는 응답 → 내부 폴백")

    // 셔츠색은 부서에서 파생한다 — 부서가 바뀌면 옷도 바뀌어야 한다.
    //
    // 씬은 노드를 재사용하므로(같은 agentType 이면 다시 만들지 않는다) 부서만 바뀐 경우
    // 방은 새 구역으로 옮겨 가는데 옷은 옛 부서색으로 남을 수 있다. 그 경로를 여기서 못 박는다.
    var shirtColors = Set<String>()
    for department in Department.allCases {
        let shirt = officeShirtColorRGB(department: department, shift: 0)
        let inRange = (0...1).contains(shirt.red) && (0...1).contains(shirt.green)
            && (0...1).contains(shirt.blue)
        t.expect(inRange, "\(department.label) 셔츠색이 0~1 범위")
        shirtColors.insert("\(shirt.red),\(shirt.green),\(shirt.blue)")
    }
    t.expectEqual(shirtColors.count, 6, "부서 6종의 셔츠색이 서로 다름")

    // 같은 사람(같은 shift)이 부서를 옮기면 셔츠색이 반드시 달라진다.
    let beforeMove = officeShirtColorRGB(department: .internalOps, shift: 0.06)
    let afterMove = officeShirtColorRGB(department: .review, shift: 0.06)
    t.expect(
        beforeMove != afterMove,
        "부서를 옮기면 셔츠색이 바뀐다(내부 → 리뷰)"
    )
    // 같은 부서 안에서도 사람마다 톤이 다르다 — 부서를 옮겨도 이 개성은 유지돼야 한다.
    t.expect(
        officeShirtColorRGB(department: .review, shift: 0) != afterMove,
        "같은 부서라도 사람별 보정(shift)이 색을 가른다"
    )
    // 파스텔 규칙: 원색보다 흰색에 가깝다(작업복이지 코스튬이 아니다).
    let palette = agentDepartmentPaletteRGBA(.review)
    let shirt = officeShirtColorRGB(department: .review, shift: 0)
    t.expect(
        shirt.red > palette.red && shirt.green > palette.green && shirt.blue > palette.blue,
        "셔츠는 부서 원색보다 밝다"
    )

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
