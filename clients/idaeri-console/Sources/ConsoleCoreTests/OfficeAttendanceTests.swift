import Foundation

@testable import ConsoleCore

private func attendanceInput(
    hasActiveRun: Bool = false,
    doneToday: Int = 0,
    isQueued: Bool = false
) -> OfficeAttendanceInput {
    OfficeAttendanceInput(
        hasActiveRun: hasActiveRun,
        doneToday: doneToday,
        isQueued: isQueued
    )
}

func runOfficeAttendanceTests(_ t: TestRunner) {
    t.suite("OfficeAttendance")

    // 시각 경계를 씬이 아니라 Core 에 고정한다. 씬으로 새면 렌더 없이 회귀를 잡을 수 없다.
    t.expectEqual(officeEarlyBirdStartHour, 5, "조기 출근 인정 시작 시각")
    t.expectEqual(officeArrivalHour, 9, "정규 출근 시각")
    t.expectEqual(officeDepartureHour, 21, "이 시각부터 퇴근")

    // 규칙 3 — 정규 근무 시간의 양 끝. 20시는 아직 present, 21시부터 away.
    t.expectEqual(officeAttendance(hour: 9, input: attendanceInput()), .present, "9시 출근")
    t.expectEqual(officeAttendance(hour: 20, input: attendanceInput()), .present, "20시는 아직 근무")
    t.expectEqual(officeAttendance(hour: 21, input: attendanceInput()), .away, "21시부터 퇴근")
    t.expectEqual(officeAttendance(hour: 8, input: attendanceInput()), .away, "8시엔 일 없으면 집")

    // 규칙 4 — 조기 출근자. 새벽 5시 INVEST · 8시 PM 이 실측으로 존재한다.
    t.expectEqual(
        officeAttendance(hour: 5, input: attendanceInput(doneToday: 1)),
        .present,
        "새벽 5시에 이미 처리한 사람은 앉아 있다"
    )
    t.expectEqual(
        officeAttendance(hour: 4, input: attendanceInput(doneToday: 1)),
        .away,
        "4시는 조기 출근으로 인정하지 않는다"
    )

    // 규칙 2 — 진행 중 실행은 시각을 이긴다. 일하는 사람이 빈 자리에 있으면 안 된다.
    t.expectEqual(
        officeAttendance(hour: 3, input: attendanceInput(hasActiveRun: true)),
        .present,
        "새벽 3시에 돌고 있으면 앉아 있다"
    )

    // 규칙 1 — 줄이 최우선. 줄 선 사람을 퇴근시키면 대기열이 실제 상태와 어긋난다.
    t.expectEqual(
        officeAttendance(hour: 23, input: attendanceInput(isQueued: true)),
        .present,
        "대표실 줄에 선 사람은 퇴근 시각에도 남는다"
    )

    // 자정 리셋 회귀 — doneToday 는 KST 자정에 0 이 된다. 22시에 present 였던 사람이
    // 0시에 doneToday 0 으로 바뀌어도, 진행 중 실행이 없으면 away 여야 한다(뒤집힘이 아니라
    // 퇴근으로 읽혀야 한다). 반대로 진행 중이면 doneToday 0 이어도 남는다.
    t.expectEqual(
        officeAttendance(hour: 0, input: attendanceInput(doneToday: 0)),
        .away,
        "자정 이후 일 없으면 집"
    )
    t.expectEqual(
        officeAttendance(hour: 0, input: attendanceInput(hasActiveRun: true, doneToday: 0)),
        .present,
        "자정을 넘겨 야근 중이면 doneToday 가 0 이어도 남는다"
    )

    // 24시 밖 입력도 같은 시계로 접는다(기존 officeDaylight 와 같은 방어).
    t.expectEqual(officeAttendance(hour: 33, input: attendanceInput()), .present, "33시 = 9시")
    t.expectEqual(officeAttendance(hour: -1, input: attendanceInput()), .away, "-1시 = 23시")
}
