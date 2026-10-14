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
}
