import Foundation

/// 회의실 벽면 판이 회의실 폭에서 차지하는 비율.
///
/// 방 전체를 덮지 않게 하는 값이다. 처음에 좌우 여백만 빼고 폭을 꽉 채웠더니 판 하나가
/// 회의 테이블·책장·카펫을 통째로 가려, 회의실이 아니라 "글자가 적힌 흰 칸" 이 됐다.
public let officeBoardWidthRatio: Double = 0.74

/// 판이 차지할 세로 칸 수.
///
/// 상단 밴드는 벽 포함 5칸이고 그중 방 안쪽이 4칸이다. 판이 그보다 높으면 위로는 창문을,
/// 아래로는 문패 줄(복도)을 침범한다.
public let officeBoardHeightTiles: Double = 1.4

/// 판을 방 바닥줄에서 얼마나 띄워 벽에 걸 것인가(격자 칸).
///
/// 벽에 걸린 것처럼 보이려면 바닥에서 떨어져야 하는데, 너무 올리면 벽 위쪽 창문을 가린다.
/// 회의실 방 높이가 4칸뿐이라 이 값의 여유가 크지 않다.
///
/// **작은 창을 기준으로 잡는다.** 방 문패는 글자 크기에 하한이 있어 창이 작아질수록 타일
/// 대비 커진다 — 1.05 칸이었을 때 960×563 에서 "회의실"·"기획" 문패가 판 글자를 덮었다.
/// 판을 문패 뒤로 보내는 것만으로는 글자가 가려지는 것을 못 막는다(자리를 비켜야 한다).
public let officeBoardLiftTiles: Double = 1.62

/// 글자 크기의 하한(포인트). 이보다 작아지면 읽는 것이 아니라 '무언가 적혀 있다' 만 남는다.
///
/// 하한이 필요한 이유는 창을 줄일 때다 — 폭에 맞춰 글자를 계속 줄이면 결국 아무도 못 읽는
/// 회색 줄이 된다. 하한에 걸린 줄은 줄이는 대신 접는다(§`officeBoardVisibleLineCount`).
public let officeBoardMinimumFontSize: Double = 8.0

/// 판에 그릴 한 줄의 재료. 뷰가 아니라 계산 결과라 씬 없이도 검증할 수 있다.
public struct OfficeBoardLine: Equatable, Sendable {
    public let text: String
    public let fontSize: Double

    public init(text: String, fontSize: Double) {
        self.text = text
        self.fontSize = fontSize
    }
}

/// 회의실 벽면 판의 배치(순수).
public struct OfficeBoardLayout: Equatable, Sendable {
    /// 판 자체의 크기(포인트).
    public let width: Double
    public let height: Double
    /// 제목과 본문 줄들.
    public let titleFontSize: Double
    public let lines: [OfficeBoardLine]

    public init(
        width: Double, height: Double, titleFontSize: Double, lines: [OfficeBoardLine]
    ) {
        self.width = width
        self.height = height
        self.titleFontSize = titleFontSize
        self.lines = lines
    }
}

/// 한글 한 글자가 차지하는 가로폭을 글자 크기 대비로 어림한 값.
///
/// 정확한 측정은 폰트 메트릭이 필요하지만, 여기서 필요한 것은 "이 줄이 판을 넘치는가" 하나다.
/// 한글은 전각이라 글자 크기와 폭이 거의 같고, 숫자·영문·공백이 섞이면 그보다 좁다. 넘침을
/// 막는 것이 목적이므로 **넉넉한 쪽(전각 기준)** 으로 잡는다.
private let fullWidthRatio: Double = 1.0
private let halfWidthRatio: Double = 0.55

/// 문자열이 주어진 글자 크기에서 차지하는 가로폭(포인트).
public func officeBoardTextWidth(_ text: String, fontSize: Double) -> Double {
    var units = 0.0
    for character in text {
        // 아스키(숫자·영문·공백·기호)는 반각으로, 한글·전각 기호는 전각으로 센다.
        units += character.isASCII ? halfWidthRatio : fullWidthRatio
    }
    return units * fontSize
}

/// 판에 들어갈 줄들을 폭에 맞춰 배치한다(순수).
///
/// **글자를 자르지 않고 줄인다.** 말줄임표로 자르면 "PR #1005 리뷰 회수" 가 "PR #100…" 이 되어
/// 어느 PR 인지 사라진다. 대신 그 줄이 판 안에 들어갈 때까지 글자 크기를 낮춘다.
///
/// **하한에 걸리면 접는다.** 창을 아주 작게 줄였을 때 읽을 수 없는 글자를 남기느니 줄 수를
/// 줄이는 편이 낫다. 접힌 줄은 `lines` 에 나타나지 않는다.
/// 줄과 줄 사이 간격(글자 크기 대비). 씬의 그리기 코드와 **같은 값을 써야 한다** — 계산은
/// 촘촘한 간격으로 하고 그리기는 성긴 간격으로 하면, 들어간다고 판정한 줄이 판 밖으로 흐른다.
public let officeBoardLineSpacing: Double = 1.3
/// 제목 아래 여백(제목 크기 대비).
public let officeBoardTitleSpacing: Double = 1.35
/// 판 안에서 글자가 쓸 수 있는 세로 비율. 나머지는 판 테두리 안쪽 여백이다.
public let officeBoardVerticalUsage: Double = 0.86

public func officeBoardLayout(
    todos: [ConsoleTodo],
    streak: ConsoleStreak?,
    boardWidth: Double,
    boardHeight: Double
) -> OfficeBoardLayout {
    let usableWidth = boardWidth * 0.88
    let usableHeight = boardHeight * officeBoardVerticalUsage
    let allTexts = boardTexts(todos: todos, streak: streak)
    // 제목 한 줄 + 본문 줄들이 세로를 나눠 쓴다.
    //
    // **줄 수로 균등 분배하면 안 된다.** 제목 간격(1.35)이 줄 간격(1.3)보다 커서, 균등하게
    // 나눈 값으로는 합이 늘 usableHeight 를 1% 남짓 넘는다 — 마지막 줄이 매번 잘려 나갔다.
    // 실제로 쓰는 간격을 그대로 분모에 넣어야 계산과 배치가 맞는다.
    let spacingTotal =
        officeBoardTitleSpacing
        + Double(allTexts.count) * officeBoardLineSpacing
    let perRow = usableHeight / max(spacingTotal, officeBoardLineSpacing)
    let titleFontSize = max(officeBoardMinimumFontSize, min(perRow, 13))

    // **넘치는 줄은 버린다.** 폰트만 맞추고 줄 수를 안 세면 마지막 줄이 판 아래로 흘러 문패
    // 위에 겹친다(실제로 그렇게 그려졌다). 계산이 줄 수까지 책임져야 씬이 그대로 그릴 수 있다.
    var consumed = titleFontSize * officeBoardTitleSpacing
    var lines: [OfficeBoardLine] = []
    for text in allTexts {
        guard
            let fitted = fittedFontSize(
                text: text, usableWidth: usableWidth, heightBudget: perRow
            )
        else {
            continue
        }
        let needed = fitted * officeBoardLineSpacing
        if consumed + needed > usableHeight {
            break
        }
        consumed += needed
        lines.append(OfficeBoardLine(text: text, fontSize: fitted))
    }

    return OfficeBoardLayout(
        width: boardWidth,
        height: boardHeight,
        titleFontSize: titleFontSize,
        lines: lines
    )
}

/// 판에 적을 문장들. 할 일이 없으면 그 사실을 적는다 — 빈 판은 고장과 구별되지 않는다.
public func boardTexts(todos: [ConsoleTodo], streak: ConsoleStreak?) -> [String] {
    var texts = todos.map { "· \($0.label) — \($0.detail)" }
    if texts.isEmpty {
        texts.append("· 밀린 일 없음")
    }
    guard let streak else {
        return texts
    }
    texts.append(streakText(streak))
    return texts
}

/// 연속 기록 한 줄. 끊긴 상태를 감추지 않는다 — 감추면 다시 이어 붙일 이유가 사라진다.
public func streakText(_ streak: ConsoleStreak) -> String {
    if streak.current > 0 {
        return "🔥 깨끗하게 마감 \(streak.current)일 연속"
    }
    if streak.best > 0 {
        return "연속 0일 (최고 \(streak.best)일)"
    }
    return "연속 기록 없음"
}

private func fittedFontSize(
    text: String, usableWidth: Double, heightBudget: Double
) -> Double? {
    let ceiling = min(heightBudget, 12)
    if ceiling < officeBoardMinimumFontSize {
        return nil
    }
    let naturalWidth = officeBoardTextWidth(text, fontSize: ceiling)
    if naturalWidth <= usableWidth {
        return ceiling
    }
    let shrunk = ceiling * (usableWidth / naturalWidth)
    if shrunk < officeBoardMinimumFontSize {
        return nil
    }
    return shrunk
}

/// 회의실 벽면 판 노드 이름. 갱신 때 통째로 지우고 다시 그린다.
public let officeMeetingBoardNodeName = "briefing:board"
/// 대표 옆 정산 종이 노드 이름.
public let officeDailyReportNodeName = "briefing:paper"
/// 정산 종이를 펼쳤을 때 뜨는 카드 이름.
public let officeDailyReportCardNodeName = "briefing:paper-card"
/// 히트 판정에서 정산 종이를 가리키는 키. 대표(`officeHitTargetPresident`)보다 먼저 재야 한다 —
/// 종이가 더 작고 대표 옆에 붙어 있어, 순서를 뒤집으면 종이를 눌러도 지시 입력창이 열린다.
public let officeHitTargetDailyReport = "__daily_report__"
