import Foundation

@testable import ConsoleCore

func runOfficeZoneHitTests(_ t: TestRunner) {
    t.suite("OfficeZoneHit")

    // 씬이 들고 있는 것은 `plan.zones: [DepartmentZone]` 이므로 그 타입을 그대로 받는다
    // (`OfficeFloorPlan.swift:1347` — department · origin: TilePoint · width · height).
    let zones = [
        DepartmentZone(
            department: .planning, origin: TilePoint(x: 1, y: 6), width: 10, height: 7
        ),
        DepartmentZone(
            department: .engineering, origin: TilePoint(x: 13, y: 6), width: 10, height: 7
        ),
    ]

    // 기획 방 안쪽(격자 3, 8) → 화면 (3.5*40, 8*40) = (140, 320)
    t.expectEqual(
        officeZoneAt(x: 140, y: 320, zones: zones, tileSize: 40, originX: 0, originY: 0),
        .planning,
        "기획 방 안쪽을 누르면 기획"
    )
    // 개발 방 안쪽(격자 15, 8)
    t.expectEqual(
        officeZoneAt(x: 620, y: 320, zones: zones, tileSize: 40, originX: 0, originY: 0),
        .engineering,
        "개발 방 안쪽을 누르면 개발"
    )
    // 복도(격자 12, 8) — 두 방 사이. 방이 아니다.
    t.expectNil(
        officeZoneAt(x: 500, y: 320, zones: zones, tileSize: 40, originX: 0, originY: 0),
        "복도는 방이 아니다"
    )
    // 방보다 아래(격자 3, 2) — 대표실 밴드 쪽.
    t.expectNil(
        officeZoneAt(x: 140, y: 80, zones: zones, tileSize: 40, originX: 0, originY: 0),
        "구역 밖 세로 위치는 방이 아니다"
    )
    // 원점이 밀린 경우에도 같은 판정이 나온다. 방 뷰에서는 원점이 음수가 된다.
    t.expectEqual(
        officeZoneAt(
            x: 140 - 200, y: 320 - 150, zones: zones,
            tileSize: 40, originX: -200, originY: -150
        ),
        .planning,
        "원점 이동을 반영한다"
    )
    // 경계는 시작 칸을 포함하고 끝 칸을 제외한다 — 두 방이 붙어도 한 곳으로만 판정된다.
    t.expectEqual(
        officeZoneAt(x: 40, y: 240, zones: zones, tileSize: 40, originX: 0, originY: 0),
        .planning,
        "구역 시작 칸은 포함"
    )
    t.expectNil(
        officeZoneAt(x: 440, y: 240, zones: zones, tileSize: 40, originX: 0, originY: 0),
        "구역 끝 칸(x=11)은 제외"
    )
    // 타일 크기가 0 이면 판정하지 않는다(0 나눗셈 방어).
    t.expectNil(
        officeZoneAt(x: 140, y: 320, zones: zones, tileSize: 0, originX: 0, originY: 0),
        "타일 크기 0 이면 nil"
    )

    // 배율 판정이 쓰는 사각형으로 옮긴다.
    let rect = officeZoneRect(zones[0])
    t.expectEqual(rect.x, 1, "구역 x")
    t.expectEqual(rect.y, 6, "구역 y")
    t.expectEqual(rect.width, 10, "구역 폭")
    t.expectEqual(rect.height, 7, "구역 높이")

    // ── `--room` 인자 파싱 ──────────────────────────────────────────────────
    t.expectEqual(officeParseDepartment("engineering"), .engineering, "영문 키")
    t.expectEqual(officeParseDepartment("ENGINEERING"), .engineering, "대문자")
    t.expectEqual(officeParseDepartment("internal-ops"), .internalOps, "하이픈")
    t.expectEqual(officeParseDepartment("internal_ops"), .internalOps, "밑줄")
    t.expectEqual(officeParseDepartment("internalOps"), .internalOps, "케이스 이름 그대로")
    t.expectNil(officeParseDepartment("없는부서"), "모르는 값은 nil")
    t.expectNil(officeParseDepartment(""), "빈 문자열은 nil")
    // 여섯 부서 전부 파싱된다 — 하나라도 빠지면 그 방은 렌더로 확인할 수 없다.
    for department in Department.allCases {
        t.expectEqual(
            officeParseDepartment(department.rawValue), department,
            "\(department.rawValue) 가 파싱된다"
        )
    }

    // ── 빈 명단에서도 구역이 있는가 ──────────────────────────────────────────
    // 백엔드가 꺼지면 스냅샷이 빈 배열이다. 그 상태에서 구역이 없으면 `--room` 렌더가
    // 조용히 전체 뷰로 폴백해 "성공한 그림" 을 저장한다(실제로 그렇게 저장됐다).
    let emptyPlan = officeFloorPlan(agents: [])
    t.expectEqual(emptyPlan.zones.count, 0, "빈 명단에서는 부서 구역이 없다")
}
