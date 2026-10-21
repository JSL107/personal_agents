import Foundation

@testable import ConsoleCore

func runConsoleTimeTests(_ t: TestRunner) {
    t.suite("ConsoleTime")
    t.expectEqual(officeArrivalHour, 9, "정규 출근 시각")
    t.expectEqual(officeDepartureHour, 21, "이 시각부터 퇴근")
    t.expect(officeParseIsoDate("2026-09-09T05:00:00.123Z") != nil, "분수초 ISO8601")
    t.expect(officeParseIsoDate("2026-09-09T05:00:00Z") != nil, "초 단위 ISO8601")
    t.expect(officeParseIsoDate(nil) == nil, "nil 날짜")
    t.expect(officeParseIsoDate("") == nil, "빈 날짜")
}
