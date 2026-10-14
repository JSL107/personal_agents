import Foundation
@testable import ConsoleCore

func runDeliveriesTests(_ t: TestRunner) {
    t.suite("Deliveries")
    let json = """
    {"data":{"status":"SUPPRESSED","days":14,"limit":50,"items":[
      {"id":1,"kind":"AUTOPILOT","itemKinds":["work-reviewer","daily-eval"],"target":"owner","channelId":null,"messageTs":null,"threadTs":null,"status":"SUPPRESSED","suppressReason":"CONSOLE_ROUTE","textPreview":"미리보기","fullText":"전체\\n내용","errorMessage":null,"reactionCount":0,"replyCount":0,"createdAt":"2026-10-12T15:30:00.000Z"},
      {"id":2,"kind":"AUTOPILOT","itemKinds":["future-kind"],"target":"owner","channelId":null,"messageTs":null,"threadTs":null,"status":"SUPPRESSED","suppressReason":"CONSOLE_ROUTE","textPreview":"대체 본문","fullText":null,"errorMessage":null,"reactionCount":0,"replyCount":0,"createdAt":"2026-10-12T14:30:00.000Z"},
      {"id":3,"kind":"AUTOPILOT","itemKinds":["run-retro"],"target":"owner","channelId":null,"messageTs":null,"threadTs":null,"status":"SUPPRESSED","suppressReason":"CONSOLE_ROUTE","textPreview":"더 늦은 글","fullText":null,"errorMessage":null,"reactionCount":0,"replyCount":0,"createdAt":"2026-10-12T16:00:00.000Z"}
    ]}}
    """
    struct Envelope: Decodable { let data: ListDeliveriesResult }
    do {
        let result = try JSONDecoder().decode(Envelope.self, from: Data(json.utf8)).data
        t.expectEqual(result.status, "SUPPRESSED")
        t.expectEqual(result.days, 14)
        t.expectEqual(result.items[0].channelId, nil)
        t.expectEqual(result.items[0].title, "업무 회고 · 일일 평가")
        t.expectEqual(result.items[1].title, "future-kind")
        t.expectEqual(result.items[0].bodyText, "전체\n내용")
        t.expectEqual(result.items[1].bodyText, "대체 본문")
        t.expectEqual(deliveryTimeLabel(result.items[0].createdAt), "00:30")
        let groups = groupDeliveries(result.items)
        t.expectEqual(groups.map(\.dayKey), ["2026-10-13", "2026-10-12"])
        t.expectEqual(groups[0].label, "10월 13일 (화)")
        t.expectEqual(groups[0].rows.map(\.id), [3, 1])
        t.expectEqual(groups[1].rows.map(\.id), [2])
    } catch { t.fail("봉투 디코딩 실패: \(error)") }

    // 서버가 소수점 없는 시각을 보내는 경우의 대체 해석 경로.
    t.expect(deliveryDate("2026-10-12T15:30:00Z") != nil, "소수점 없는 ISO-8601 도 읽는다")
    t.expectEqual(deliveryTimeLabel("2026-10-12T15:30:00Z"), "00:30")

    // 날짜를 못 읽은 행을 버리면 건수는 있는데 목록이 빈 화면이 된다 — 「날짜 미상」 묶음으로 남긴다.
    let broken = SlackDeliveryListRow(id: 9, kind: "AUTOPILOT", itemKinds: ["run-retro"], target: "owner",
                                      status: "SUPPRESSED", textPreview: "깨진 시각", createdAt: "어제")
    let dated = SlackDeliveryListRow(id: 8, kind: "AUTOPILOT", itemKinds: ["run-retro"], target: "owner",
                                     status: "SUPPRESSED", textPreview: "정상", createdAt: "2026-10-12T15:30:00Z")
    let mixed = groupDeliveries([broken, dated])
    t.expectEqual(mixed.map(\.dayKey), ["2026-10-13", unknownDeliveryDayKey])
    t.expectEqual(mixed.last?.label, "날짜 미상")
    t.expectEqual(groupDeliveries([broken]).flatMap(\.rows).map(\.id), [9])

    // 서버는 최신 limit 건만 주므로, 꽉 찬 응답은 잘렸을 수 있다.
    t.expect(ListDeliveriesResult(status: "SUPPRESSED", days: 14, limit: 2, items: [broken, dated]).isTruncated,
             "한도만큼 받으면 잘림으로 본다")
    t.expect(!ListDeliveriesResult(status: "SUPPRESSED", days: 14, limit: 3, items: [broken, dated]).isTruncated,
             "한도보다 적으면 전부 받은 것이다")
}
