import AppKit
import Foundation

@testable import ConsoleCore

/// 실사용 창(960×1050)에서 부서가 2열로 잡힐 때의 타일 크기(씬 좌표 기준, 960 / 23열).
///
/// **렌더 PNG 의 픽셀로 재면 안 된다.** 캡처가 2배라 83.5 를 넣었더니 실제보다 두 배 넉넉한
/// 자리에서 계산해 "다 들어간다" 는 결론이 나왔다 — 화면에서는 잘려 있는데 테스트는 초록이었다.
private let realTileSize = 960.0 / 23.0

/// 앱과 같은 글꼴·같은 크기로 실제 문자열을 잰다. 글자 수로 어림하면 숫자·기호가 섞인 문구
/// (`19:04`, `외 2건`)에서 어긋난다.
private func bubbleGlyphWidth(_ text: String, tileSize: Double) -> Double {
    let size = officeBubbleFontSize(tileSize: tileSize)
    let font = NSFont(name: officeLabelFontName, size: size) ?? .boldSystemFont(ofSize: size)
    return Double(NSAttributedString(string: text, attributes: [.font: font]).size().width)
}

private let sampleStreak = ConsoleStreak(
    current: 0, best: 3, todayOpened: 0, todayRemaining: 0
)

func runPresidentBriefingTests(_ t: TestRunner) {
    t.suite("PresidentBriefing")

    // MARK: 대표 머리 위 할 일 말풍선

    // 할 일이 없으면 말풍선이 뜨지 않는다. 빈 말풍선을 띄우면 "할 일 없음" 을 종일 이고
    // 서 있게 되는데, 조용한 화면이 곧 그 뜻이다.
    t.expect(
        officePresidentTodoLines(todos: []).isEmpty,
        "할 일이 없으면 후보가 없어야 한다"
    )

    // 한 건이면 그 한 건을 그대로 말한다.
    let single = officePresidentTodoLines(todos: [
        ConsoleTodo(kind: .prReview, label: "PR 리뷰 회수 2건", detail: "10일째")
    ]).first
    t.expect(
        single == "PR 리뷰 회수 2건 — 10일째",
        "한 건은 라벨과 상세를 붙여 말해야 한다 (실제: \(single ?? "없음"))"
    )

    // 여러 건이면 **가장 급한 하나** 를 말하고 나머지는 건수로 접는다. 목록 순서가 급한
    // 순서라는 계약(백엔드가 승인 → 실패 → 리뷰 순으로 조립)을 여기서 검증한다 — 순서가
    // 뒤집히면 급하지 않은 것을 대표 머리 위에 이고 있게 된다.
    let many = officePresidentTodoLines(todos: [
        ConsoleTodo(kind: .approval, label: "승인 3건", detail: "19:04 만료"),
        ConsoleTodo(kind: .failedRun, label: "PM 재시도", detail: "다음 실행은 내일"),
        ConsoleTodo(kind: .prReview, label: "PR 리뷰 회수 2건", detail: "10일째"),
    ]).first
    t.expect(
        many == "승인 3건 — 19:04 만료 · 외 2건",
        "여러 건은 첫 건 + 외 N건으로 접어야 한다 (실제: \(many ?? "없음"))"
    )

    // **한 줄에 들어가야 한다.** 대표실은 화면 최상단 밴드라 두 줄로 접히면 윗줄이 창문 위
    // 벽을 넘어 화면 밖으로 나간다. 말줄임표가 붙으면 몫을 넘겼다는 뜻이다.
    let budget = officePresidentBubbleWidthTiles * realTileSize
    for line in [many, single].compactMap({ $0 }) {
        let wrapped = officeWrapBubble(
            line, maxWidth: budget, maxLines: officePresidentBubbleMaxLines
        ) { bubbleGlyphWidth($0, tileSize: realTileSize) }
        t.expect(
            !wrapped.contains("\n"),
            "말풍선은 한 줄이어야 한다: \(wrapped)"
        )
        t.expect(
            !wrapped.contains("…"),
            "실사용 창에서 잘리지 않아야 한다 (\(Int(budget))pt 몫): \(wrapped)"
        )
    }

    // 후보는 **긴 것부터** 짧아진다. 씬이 앞에서부터 고르므로 순서가 뒤집히면 넉넉한 창에서도
    // 축약본이 뜬다.
    let candidates = officePresidentTodoLines(todos: [
        ConsoleTodo(kind: .approval, label: "승인 3건", detail: "19:04 만료"),
        ConsoleTodo(kind: .failedRun, label: "PM 재시도", detail: "다음 실행은 내일"),
        ConsoleTodo(kind: .prReview, label: "PR 리뷰 회수 2건", detail: "10일째"),
    ])
    t.expect(
        candidates.count >= 2 && candidates[0].count > candidates[1].count,
        "후보는 긴 것부터 와야 한다: \(candidates)"
    )

    // **작은 창에서도 "외 N건" 이 남아야 한다.**
    //
    // 글자 크기에는 하한이 있어 창을 줄이면 글자는 그대로인데 몫만 좁아진다 — 960×563 에서
    // 굽어 보니 긴 문장의 끝이 잘려 `· …` 이 됐고, 하필 사라진 것이 "다른 할 일이 2건 더
    // 있다" 였다. 그래서 상세를 버린 짧은 후보가 그 창에 들어가는지까지 재야 한다.
    //
    // 타일 크기는 레포 실측값을 쓴다 — 27.4 = 960×563, 20.6 = 최소 창(640×560).
    for smallTile in [27.4, 20.6] {
        let smallBudget = officePresidentBubbleWidthTiles * smallTile
        let picked = candidates.first {
            bubbleGlyphWidth($0, tileSize: smallTile) <= smallBudget
        }
        t.expect(
            picked?.contains("외 2건") == true,
            "타일 \(smallTile)pt 에서도 남은 건수가 남아야 한다 (고른 후보: \(picked ?? "없음"))"
        )
    }

    // **긴 워커 이름에서도 건수가 남아야 한다.**
    //
    // 실패 할 일의 라벨은 백엔드가 `${agentType} 재시도` 로 만든다(`buildFailedRunTodo`) — 즉
    // `IMPACT_REPORTER` 처럼 15자짜리 이름이 라벨에 그대로 들어온다. 짧은 `승인 3건` 으로만
    // 재면 이 경우가 통째로 빠진다.
    let longNameCandidates = officePresidentTodoLines(todos: [
        ConsoleTodo(kind: .failedRun, label: "IMPACT_REPORTER 재시도", detail: "다음 실행은 내일"),
        ConsoleTodo(kind: .prReview, label: "PR 리뷰 회수 2건", detail: "10일째"),
    ])
    for smallTile in [realTileSize, 27.4, 20.6] {
        let smallBudget = officePresidentBubbleWidthTiles * smallTile
        let picked = longNameCandidates.first {
            bubbleGlyphWidth($0, tileSize: smallTile) <= smallBudget
        }
        t.expect(
            picked != nil,
            "타일 \(smallTile)pt 에서 들어가는 후보가 하나는 있어야 한다"
        )
        t.expect(
            picked?.contains("2건") == true || picked?.contains("외 1건") == true,
            "긴 워커 이름에서도 남은 할 일이 몇 건인지 남아야 한다 (고른 후보: \(picked ?? "없음"))"
        )
    }

    // MARK: 연속 기록 벽 게시판

    // 도장은 개수로만 말한다 — 연속 0일이면 빈 달력이고, 그 자체가 "끊겼다" 는 신호다.
    t.expect(
        officeStreakStampCount(sampleStreak) == 0,
        "연속 0일이면 도장이 없어야 한다(빈 게시판)"
    )
    t.expect(
        officeStreakStampCount(
            ConsoleStreak(current: 3, best: 5, todayOpened: 0, todayRemaining: 0)
        ) == 3,
        "연속 3일이면 도장 3개"
    )
    // 상한이 없으면 도장이 달력을 넘어 벽으로 번진다.
    t.expect(
        officeStreakStampCount(
            ConsoleStreak(current: 40, best: 40, todayOpened: 0, todayRemaining: 0)
        ) == officeStreakStampMaxCount,
        "상한을 넘는 연속은 상한에서 멈춘다"
    )
    // 백엔드가 음수를 낼 일은 없지만, 나면 도장 -1개가 아니라 0개여야 한다.
    t.expect(
        officeStreakStampCount(
            ConsoleStreak(current: -2, best: 0, todayOpened: 0, todayRemaining: 0)
        ) == 0,
        "음수는 0으로 접는다"
    )

    // 상한까지 찍어도 게시판을 넘지 않는다. 상수 셋의 관계라 눈으로는 3px 초과가 안 보인다 —
    // 넘치면 도장이 코르크판 밖 벽에 떠 있는 점이 된다.
    let stampSpan =
        officeStreakStampStepRatio * Double(officeStreakStampMaxCount - 1)
        + officeStreakStampDiameterRatio
    t.expect(
        stampSpan <= 1.0,
        "도장 \(officeStreakStampMaxCount)개가 게시판 폭을 넘지 않아야 한다 (실제 \(stampSpan))"
    )
    // 간격이 지름보다 좁으면 도장이 서로 붙어 개수를 셀 수 없다.
    t.expect(
        officeStreakStampStepRatio > officeStreakStampDiameterRatio,
        "도장 간격이 지름보다 넓어야 한다"
    )

    // 도장은 **대표실** 게시판에만 찍힌다.
    //
    // 게시판은 기획방·리뷰방 벽에도 걸려 있다. kind 로만 찾으면 목록에서 먼저 나온 남의 방
    // 게시판이 잡혀 도장이 엉뚱한 벽에 찍히는데, 그건 렌더를 봐야 알아차린다.
    let presidentArea = CommonArea(
        kind: .president, label: "대표실", icon: "👑", originX: 12, width: 11, labelY: 30
    )
    let picked = officeStreakBoardTile(
        furniture: [
            // 기획방 게시판이 목록에서 먼저 온다 — 순서에 기대면 이것이 잡힌다.
            FurniturePlacement(kind: .wallPinboard, tile: TilePoint(x: 3, y: 20)),
            FurniturePlacement(kind: .wallPinboard, tile: TilePoint(x: 13, y: 33)),
        ],
        presidentArea: presidentArea
    )
    t.expect(
        picked == TilePoint(x: 13, y: 33),
        "대표실 안 게시판을 골라야 한다 (실제: \(String(describing: picked)))"
    )
    // 대표실에 게시판이 없으면 도장을 찍을 곳이 없다 — nil 이어야 그리기를 건너뛴다.
    t.expect(
        officeStreakBoardTile(
            furniture: [
                FurniturePlacement(kind: .wallPinboard, tile: TilePoint(x: 3, y: 20))
            ],
            presidentArea: presidentArea
        ) == nil,
        "대표실 밖 게시판만 있으면 nil 이어야 한다"
    )

    // 실제 배치에도 대표실 게시판이 있어야 한다. 상수와 계산이 맞아도 배치에서 빠지면
    // 도장은 영영 안 그려진다(등록만 하고 배치를 빠뜨려 조용히 사라진 소품이 일곱 장 있었다).
    for columns in [2, 3] {
        let plan = officeFloorPlan(agents: [], zoneColumns: columns)
        let tile = officeStreakBoardTile(
            furniture: plan.furniture,
            presidentArea: plan.commonAreas.first { $0.kind == .president }
        )
        t.expect(
            tile != nil,
            "\(columns)열 배치에서 대표실 벽에 게시판이 걸려야 한다"
        )
    }

    // 최고 기록은 도장이 말하지 못한다 — 문장이 맡는다.
    t.expect(
        streakText(sampleStreak).contains("최고 3일"),
        "끊긴 상태에서도 최고 기록을 남겨야 한다: \(streakText(sampleStreak))"
    )

    // 정산 종이는 저녁에만 놓인다
    t.expect(!officeShowsDailyReport(hour: 10), "낮에는 종이를 놓지 않는다")
    t.expect(!officeShowsDailyReport(hour: 20), "퇴근 시각 전에는 놓지 않는다")
    t.expect(officeShowsDailyReport(hour: 21), "퇴근 시각부터 놓는다")
    t.expect(officeShowsDailyReport(hour: 23), "자정 직전까지 놓는다")
    // 자정을 넘기면 성적이 리셋되므로 빈 종이를 남기지 않는다.
    t.expect(!officeShowsDailyReport(hour: 0), "자정 이후에는 걷는다")

    // 종이가 대표보다 먼저 잡힌다 — 히트 판정 순서
    //
    // 종이는 대표실 왼쪽 끝, 대표는 방 가운데다. 둘 사이를 누르면 가까운 쪽이 이기는데,
    // 순서를 뒤집으면 종이를 눌러도 지시 입력창이 열린다(설계서가 남긴 회귀 위험).
    let paperPoint = OfficePoint(x: 100, y: 200)
    let presidentPoint = OfficePoint(x: 130, y: 200)
    let hit = agentTypeAt(
        point: OfficePoint(x: 105, y: 200),
        slots: [
            (officeHitTargetDailyReport, paperPoint),
            (officeHitTargetPresident, presidentPoint),
        ],
        radius: 40
    )
    t.expect(
        hit == officeHitTargetDailyReport,
        "종이 쪽에 가까우면 종이가 잡혀야 한다 (실제: \(hit ?? "없음"))"
    )
    let farHit = agentTypeAt(
        point: OfficePoint(x: 128, y: 200),
        slots: [
            (officeHitTargetDailyReport, paperPoint),
            (officeHitTargetPresident, presidentPoint),
        ],
        radius: 40
    )
    t.expect(
        farHit == officeHitTargetPresident,
        "대표 쪽에 가까우면 대표가 잡혀야 한다 (실제: \(farHit ?? "없음"))"
    )

    // 정산 문장이 남은 몫을 말한다
    let lines = officeDailyReportLines(
        report: ConsoleDailyReport(
            date: "2026-08-20", succeeded: 15, failed: 0,
            approvalsOpened: 2, approvalsHandled: 1, pendingReviewPulls: 3
        ),
        streak: ConsoleStreak(current: 0, best: 3, todayOpened: 2, todayRemaining: 1)
    )

    // 숫자만 늘어놓으면 "그래서 오늘 어땠는데" 가 안 남는다. 남은 몫과 그 결과를 말해야 한다.
    t.expect(
        lines.contains { $0.contains("1건이 남았습니다") },
        "남은 결재를 말해야 한다: \(lines)"
    )
    t.expect(
        lines.contains { $0.contains("연속 기록이 끊깁니다") },
        "자정을 넘기면 어떻게 되는지 말해야 한다: \(lines)"
    )
    t.expect(
        lines.contains { $0.contains("최고 3일") },
        "최고 기록을 남겨야 한다: \(lines)"
    )

}
