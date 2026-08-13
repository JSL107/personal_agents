import AppKit
import Foundation

@testable import ConsoleCore

/// 이름표 글자 상자를 **실제 글꼴로 그려 본** 폭(px). 판 여백은 포함하지 않는다.
///
/// 상수로 되계산하지 않는 이유는 그게 자기 확인이기 때문이다 — 폭 상한을 만든 계산을 테스트가
/// 같은 상수로 다시 세면, 무엇을 바꿔도 양쪽이 함께 움직여 늘 통과한다(직전 작업에서 실제로
/// 그렇게 통과시켰다). 이름표가 자리에 들어가는지는 글꼴이 정하므로, 앱과 같은 글꼴·같은
/// 크기로 실제 문자열을 재서 판정한다.
private func nameplateGlyphWidth(_ text: String, tileSize: Double) -> Double {
    let size = officeNameplateFontSize(tileSize: tileSize)
    let font = NSFont(name: officeLabelFontName, size: size) ?? .boldSystemFont(ofSize: size)
    return Double(NSAttributedString(string: text, attributes: [.font: font]).size().width)
}

private func labelGlyphWidth(_ text: String, fontSize: Double) -> Double {
    let font = NSFont(name: officeLabelFontName, size: fontSize)
        ?? .boldSystemFont(ofSize: fontSize)
    return Double(NSAttributedString(string: text, attributes: [.font: font]).size().width)
}

/// 눌러 넣기의 하한. 이 밑으로 누르면 한글 획이 붙어 이름을 못 읽는다.
///
/// 벽과 문 사이에 낀 자리(구역 상대 x=9)는 몫이 한 칸뿐이라 다섯 글자짜리 이름(`답변 판정`)이
/// 오면 절반 가까이 눌린다. 그 자리를 없애려면 배치를 다시 짜야 하고(내부 부서 10석이
/// 5열 × 2행이다), 눌린 글자는 960×563 렌더에서 읽히는 것을 확인했다. 그래서 지금 값을 하한으로
/// 못 박아 **더 나빠지는 것만** 막는다 — 이름이 길어지거나 자리가 더 좁아지면 여기서 걸린다.
private let nameplateMinSqueeze: Double = 0.5

func runOfficeNameplateFitTests(_ t: TestRunner) {
    t.suite("OfficeNameplateFit")

    // 상단 밴드와 부서 격자는 열 수에 따라 경계가 달라진다. 밴드 문패를 구역 왼쪽에
    // 고정하면 2열에서 `탕비실`이 `개발` 중앙 문패를 덮는다. 실제 글꼴·판 여백으로 두
    // 배치를 모두 재서, 격자가 다시 우연히 같아야만 성립하는 회피로 돌아가지 못하게 한다.
    for (zoneColumns, tileSize) in [(2, 37.4), (3, 40.0)] {
        let adaptivePlan = officeFloorPlan(agents: sampleAgents, zoneColumns: zoneColumns)
        let departmentRanges = adaptivePlan.zones.map { zone -> ClosedRange<Double> in
            let fontSize = max(officeZoneLabelMinFontSizeValue, tileSize * 0.38)
            let glyphWidth = labelGlyphWidth(
                "\(zone.department.icon) \(zone.department.label)", fontSize: fontSize
            )
            let plateWidth = glyphWidth + 12
            let center = (Double(zone.origin.x) + Double(zone.width) / 2) * tileSize
            return (center - plateWidth / 2)...(center + plateWidth / 2)
        }

        for area in adaptivePlan.commonAreas {
            let fontSize = max(officeZoneLabelMinFontSizeValue, tileSize * 0.32)
            let glyphWidth = labelGlyphWidth("\(area.icon) \(area.label)", fontSize: fontSize)
            let plateWidth = glyphWidth + 10
            let preferredLeading = (Double(area.originX) + 0.5) * tileSize - 5
            let availableTrailing =
                (Double(area.originX + area.width) - 0.5) * tileSize + 5
            let available = preferredLeading...availableTrailing
            let leading = officeNonOverlappingLabelLeadingX(
                preferredLeadingX: preferredLeading,
                availableRange: available,
                labelWidth: plateWidth,
                occupiedRanges: departmentRanges
            )
            let commonRange = leading...(leading + plateWidth)

            for (zone, departmentRange) in zip(adaptivePlan.zones, departmentRanges) {
                let separated =
                    commonRange.upperBound + officeLabelSeparationMinPixels
                        <= departmentRange.lowerBound
                    || departmentRange.upperBound + officeLabelSeparationMinPixels
                        <= commonRange.lowerBound
                t.expect(
                    separated,
                    "\(zoneColumns)열 \(area.label) \(commonRange)와 "
                        + "\(zone.department.label) \(departmentRange) 문패 x 범위 겹침"
                )
            }
        }
    }

    let plan = officeFloorPlan(agents: sampleAgents)

    // 창 크기 전 구간을 훑는다. 한글 글자 크기에 하한(11px)이 있어 **작은 창일수록 타일 대비
    // 이름표가 커지므로**, 큰 창만 확인하면 겹침 구간을 통째로 놓친다.
    // 20.6 = 최소 창(640×560), 27.4 = 960×563, 54.9 = 1920×1126.
    for tileSize in [20.6, 27.4, 40.0, 54.9] {
        for zone in plan.zones {
            let zoneDesks = plan.desks.filter { officeZoneContains(zone, $0.seat) }
            let seats = zoneDesks.map(\.seat)
            let room = zone.department.label
            let innerLeft = Double(zone.origin.x + 1)
            let innerRight = Double(zone.origin.x + zone.width - 1)
            let door = Double(zone.origin.x + officeZoneDoorColumn)
            var boxes: [(seat: TilePoint, start: Double, end: Double)] = []

            for desk in zoneDesks {
                let span = officeNameplateSpanTiles(
                    seat: desk.seat, seatsInZone: seats, zone: zone, tileSize: tileSize
                )
                let center = Double(desk.seat.x) + 0.5
                let start = center - span.left
                let end = center + span.right
                boxes.append((desk.seat, start, end))

                // 방 안에 머문다 — 좌우 벽 칸을 넘지 않는다.
                t.expect(
                    start >= innerLeft - 1e-9 && end <= innerRight + 1e-9,
                    "타일 \(tileSize) · \(room) x=\(desk.seat.x) 이름표 몫"
                        + "(\(start)~\(end))이 방 안쪽(\(innerLeft)~\(innerRight))을 벗어남"
                )
                // 문 칸을 덮지 않는다 — 문짝 그림과 글자가 겹치면 둘 다 안 읽힌다.
                t.expect(
                    start >= door + 1 - 1e-9 || end <= door + 1e-9,
                    "타일 \(tileSize) · \(room) x=\(desk.seat.x) 이름표 몫"
                        + "(\(start)~\(end))이 문 칸(\(door)~\(door + 1))을 덮음"
                )

                // 실제 이름이 그 몫에 들어가는가. 넘치는 몫은 눌러 흡수하지만, 너무 누르면
                // 읽을 수 없다 — 자리 간격이 아니라 **그려 본 글자**로 판정한다.
                //
                // 이름표를 전부 켜는 구간에서만 잰다. 그 아래(`officeNameplateCrowdedTileSize`
                // 미만)는 자리 한 칸이 20px 남짓이라 다섯 글자가 **어떤 방법으로도** 안 들어가고,
                // 그래서 읽히는 몇 개만 남기고 솎아 낸다(`nameplateIsVisible`). 거기까지 하한을
                // 걸면 못 고칠 한계를 붙잡고 빨간불이 켜져 있게 된다.
                let label = agentRoleLabel(for: desk.agentType) ?? desk.agentType
                let glyphWidth = nameplateGlyphWidth(label, tileSize: tileSize)
                let spanLeftPixels = span.left * tileSize
                let spanRightPixels = span.right * tileSize
                let layout = officeNameplateLayout(
                    glyphWidth: glyphWidth,
                    spanLeft: spanLeftPixels,
                    spanRight: spanRightPixels
                )

                // **눌러 넣은 뒤의 판**이 몫 안에 들어가는가.
                //
                // 배율은 글자에만 걸리고 판 여백(`officeNameplatePlatePadding`)은 눌리지
                // 않는다. 판 전체가 함께 눌린다고 보고 계산하면 실제 판이 `여백 × (1 - 배율)`
                // 만큼 몫을 넘는데, 그 크기가 3px 남짓이라 렌더를 눈으로 봐서는 못 잡는다 —
                // 벽·문 경계와 이웃 사이 6px 가 조용히 깎인다.
                let plateHalf =
                    (glyphWidth * layout.scaleX + officeNameplatePlatePadding) / 2
                t.expect(
                    layout.offsetX - plateHalf >= -spanLeftPixels - 1e-6
                        && layout.offsetX + plateHalf <= spanRightPixels + 1e-6,
                    "타일 \(tileSize) · \(room) x=\(desk.seat.x) `\(label)` 판"
                        + "(\(String(format: "%.1f", layout.offsetX - plateHalf))~"
                        + "\(String(format: "%.1f", layout.offsetX + plateHalf)))이 몫"
                        + "(-\(String(format: "%.1f", spanLeftPixels))~"
                        + "\(String(format: "%.1f", spanRightPixels)))을 넘음"
                )
                t.expect(
                    tileSize < officeNameplateCrowdedTileSize
                        || layout.scaleX >= nameplateMinSqueeze,
                    "타일 \(tileSize) · \(room) x=\(desk.seat.x) `\(label)` 가"
                        + " \(String(format: "%.2f", layout.scaleX)) 로 눌림"
                        + " (하한 \(nameplateMinSqueeze))"
                )
            }

            // 같은 줄 이웃끼리 몫이 겹치지 않고, 판이 맞닿아 한 덩어리로 읽히지도 않는다.
            //
            // 기존 회귀 테스트는 **자리 간격이 2칸 이상인지**만 봤다. 자리를 안 건드린 채
            // 이름만 길어지면(사규가 표시명을 바꾸면) 그 단언은 그대로 통과하고 화면에서만
            // 판이 붙는다 — `모순 판정│문서 평가│문서 개선│회고 발행│윤문` 이 그랬다.
            for row in Set(boxes.map(\.seat.y)) {
                let inRow = boxes.filter { $0.seat.y == row }.sorted { $0.start < $1.start }
                for (index, box) in inRow.enumerated().dropFirst() {
                    let gapPixels = (box.start - inRow[index - 1].end) * tileSize
                    t.expect(
                        gapPixels >= officeLabelSeparationMinPixels - 1e-6,
                        "타일 \(tileSize) · \(room) y=\(row) x=\(inRow[index - 1].seat.x)↔"
                            + "\(box.seat.x) 이름표 사이 \(String(format: "%.1f", gapPixels))px"
                            + " < \(officeLabelSeparationMinPixels)px"
                    )
                }
            }
        }
    }

    // 몫은 자리마다 실제로 다르다. 한 값으로 굳으면(예: 늘 2칸) 벽 옆 자리가 다시 삐져나가는데,
    // 위 단언들은 그 회귀를 큰 창에서 통과시킬 수 있다.
    let review = plan.zones.first { $0.department == .review }
    if let zone = review {
        let seats = plan.desks.filter { officeZoneContains(zone, $0.seat) }.map(\.seat)
        let widths = seats.map { seat -> Double in
            let span = officeNameplateSpanTiles(
                seat: seat, seatsInZone: seats, zone: zone, tileSize: 40
            )
            return span.left + span.right
        }
        t.expect(
            Set(widths.map { Int($0 * 100) }).count > 1,
            "\(zone.department.label) 자리마다 이름표 몫이 다르다 (실제 \(widths))"
        )
    }
}
