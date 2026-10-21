import Foundation

@testable import ConsoleCore

func runAgentRoleTests(_ t: TestRunner) {
    t.suite("AgentRole")

    let reviewAction = agentPrimaryAction(for: "CODE_REVIEWER", roleName: "박꼼꼼")
    t.expectEqual(reviewAction.label, "리뷰 맡기기", "코드 리뷰 담당자의 주 행동")
    t.expectEqual(reviewAction.title, "박꼼꼼에게 리뷰 맡기기", "리뷰 시트 제목")
    t.expect(reviewAction.placeholder.contains("PR URL"), "리뷰 입력은 PR 참조를 안내한다")
    t.expectEqual(agentPrimaryAction(for: "PM", roleName: "김기획").label, "업무 맡기기", "일반 담당자의 주 행동")

    t.expectEqual(agentRoleLabel(for: "PM"), "김기획", "기획 닉네임")
    t.expectEqual(agentRoleLabel(for: "CODE_REVIEWER"), "박꼼꼼", "품질 닉네임")
    t.expectEqual(agentRoleLabel(for: "HUMANIZER"), "윤다정", "콘텐츠 닉네임")
    t.expectEqual(agentRoleLabel(for: "OPS_SUPERVISOR"), "안정민", "총무 닉네임")
    t.expectEqual(agentRoleLabel(for: "VIDEO_WATCH"), "영상봄", "영상 분석 닉네임")
    t.expectEqual(agentRoleLabel(for: "ART_JOB_FEED"), "공고담당", "원화 공고 담당 닉네임")
    t.expectNil(agentRoleLabel(for: "NOT_A_REAL_AGENT"), "미등록 타입은 표시명으로 폴백한다")

    // The same department's avatar faces and shirt tones remain distinct and stable.
    let roommates = ["BLOG", "BLOG_PUBLISH", "BLOG_REVISION", "HUMANIZER", "CAREER_MATE"]
    let looks = officeCharacterLooks(forRoommates: roommates)
    t.expectEqual(looks.count, roommates.count, "모든 담당자에게 외형을 배정한다")
    let faces = roommates.compactMap { looks[$0] }.map { "\($0.sheetIndex)-\($0.hairIndex)" }
    t.expectEqual(Set(faces).count, roommates.count, "같은 부서의 얼굴과 머리색 조합은 겹치지 않는다")
    let tones = roommates.compactMap { looks[$0]?.shirtShift }
    t.expectEqual(Set(tones).count, roommates.count, "셔츠 톤 단계를 골고루 사용한다")
    t.expectEqual(
        officeCharacterLooks(forRoommates: roommates),
        officeCharacterLooks(forRoommates: roommates.reversed()),
        "입력 순서와 관계없이 외형이 일정하다"
    )
    let before = officeCharacterLooks(forRoommates: roommates.filter { $0 != "BLOG_REVISION" })
    let after = officeCharacterLooks(forRoommates: roommates)
    let retained = before.keys.filter { before[$0] == after[$0] }
    t.expect(retained.count * 2 > before.count, "한 명이 늘어도 과반의 얼굴은 유지한다")

    let shirtColors = roommates.compactMap { looks[$0] }.map {
        officeShirtColorRGB(department: .content, shift: $0.shirtShift)
    }
    t.expectEqual(
        Set(shirtColors.map { "\($0.red),\($0.green),\($0.blue)" }).count,
        roommates.count,
        "부서 안에서도 셔츠색이 구분된다"
    )
}
