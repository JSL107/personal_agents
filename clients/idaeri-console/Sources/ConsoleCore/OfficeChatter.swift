import Foundation

/// 배회 중 머리 위에 뜨는 한 마디.
///
/// **상태 문구가 아니라 연출이다.** "지금 무슨 일 중" 을 말하는 말풍선은 백엔드가 소유하고
/// (`agent-activity-bubble.ts`) 앱은 `ConsoleAgent.bubble` 을 그대로 표시한다 — 여기 있는 문구는
/// 그 규약을 어기는 것이 아니다. 배회는 실행 중인 run 이 없을 때(`state == .waiting`)만 일어나므로
/// 백엔드에 실을 재료가 애초에 없고, 재료 없는 문구를 받으려고 API 를 새로 파는 것이 과설계다.
///
/// 길이 상한은 백엔드 말풍선(`ACTIVITY_BUBBLE_MAX_LENGTH`)과 같은 12자다. 두 경로가 같은
/// 머리 위 자리를 쓰므로 상한이 갈리면 한쪽만 벽을 넘는다.
public let officeChatterMaxLength = 12

/// 대화 상대로 인정하는 최대 타일 거리. 3칸이면 화면에서 이미 "각자 서 있는" 것으로 보인다.
public let officeChatterPartnerMaxDistance = 2

/// 말을 건 뒤 상대가 답하기까지의 간격(초). 동시에 뜨면 대화가 아니라 두 개의 혼잣말이다.
public let officeChatterReplyDelaySeconds: Double = 1.2

/// 열 번 중 몇 번을 부서 잡담으로 할지. 나머지는 목적지 대사다.
///
/// 목적지 대사가 다수여야 하는 이유는 정보량이다 — 그쪽은 "왜 걷는지" 를 알려주고, 잡담은
/// 개성만 준다. 잡담이 절반을 넘으면 화면이 수다스러워지고 동선의 뜻이 묻힌다.
public let officeChatterSmallTalkChance = 3

// MARK: - 목적지 대사

/// 가구 앞에서 하는 한 마디. 배회 목적지가 될 수 있는 가구(`interactionPose != nil`)를 전부 덮는다.
///
/// 자세(`OfficeInteractionPose`)로 묶지 않고 가구별로 쓴 이유는 자세가 뭉갠 차이가 실제로
/// 보이기 때문이다 — 커피머신과 자판기는 둘 다 `drinking` 이지만 자판기 앞에서 "커피 한 잔" 은
/// 틀린 말이다.
public func officeDestinationChatter(kind: FurnitureKind) -> String? {
    switch kind {
    case .coffeeMachine:
        return "커피 한 잔"
    case .waterCooler:
        return "물 좀 마시자"
    case .vendingMachine:
        return "당 떨어졌다"
    case .refrigerator:
        return "간식 있나"
    case .sinkCounter:
        return "컵 좀 씻고"
    case .printer:
        return "출력 좀 하자"
    case .filingCabinet:
        return "서류 어디 갔지"
    case .whiteboard, .wallWhiteboard:
        return "한번 그려 보자"
    case .bookshelf:
        return "자료 좀 찾자"
    case .wallShelf:
        return "여기 있었네"
    case .wallMonitor:
        return "지표 좀 보자"
    case .wallPinboard:
        return "공지 봤나"
    case .plantTall:
        return "물 줘야지"
    case .plantSmall:
        return "잎이 폈네"
    case .lockers2:
        return "가방 좀 넣고"
    case .sofa2, .sofa3:
        return "잠깐 앉자"
    case .coffeeTable:
        return "숨 좀 돌리고"
    case .meetingTable:
        return "여기 비었나"
    case .desk, .chairDown, .chairUp, .clock, .trash,
        .wallLandscape, .wallAbstract, .wallCalendar, .wallCertificate, .wallPoster,
        .wallPlantHanging, .doorClosed, .doorOpen, .partitionLow, .partitionGlass,
        .rugGreen, .rugBeige, .rugNavy:
        return nil
    }
}

// MARK: - 부서 잡담

/// 부서 성격이 드러나는 혼잣말. 사람이 아니라 부서 단위로 쓴다 — 서른 명에게 각자 대사를 주면
/// 사람이 늘 때마다 문구를 따라 늘려야 하고, 화면에서 구분되는 것은 어차피 방(부서)이다.
public func officeSmallTalk(department: Department, variant: Int) -> String {
    let lines: [String]
    switch department {
    case .planning:
        lines = ["뭐부터 하지", "순서를 바꿀까", "이건 다음에"]
    case .engineering:
        lines = ["빌드 돌리자", "로그 좀 보자", "여기가 느리네"]
    case .review:
        lines = ["이건 괜찮나", "한 번 더 보자", "놓친 게 있나"]
    case .executive:
        lines = ["숫자를 보자", "정해야 하는데", "이번 주는 어때"]
    case .growth:
        lines = ["반응이 왔네", "글 좀 써야지", "이게 먹히나"]
    case .internalOps:
        lines = ["정리해야지", "많이 쌓였네", "이건 치우자"]
    }
    return lines[officeChatterIndex(variant, count: lines.count)]
}

// MARK: - 한 마디 고르기

/// 배회를 시작한 사람이 할 말. 목적지 대사와 부서 잡담을 섞는다.
///
/// **난수가 아니라 결정론이다.** 사람과 회차로 고르므로 같은 입력이 같은 문구를 내고, 그래서
/// 테스트가 섞임 비율과 상한을 단언할 수 있다. `hashValue` 는 실행마다 시드가 달라져 쓸 수 없다.
public func officeChatter(
    kind: FurnitureKind,
    department: Department,
    agentType: String,
    round: Int
) -> String {
    let seed = officeChatterSeed(agentType: agentType, round: round)
    let wantsSmallTalk = officeChatterIndex(seed, count: 10) < officeChatterSmallTalkChance
    // 목적지 대사가 없는 가구는 배회 목적지가 아니지만(`interactionPose == nil`), 폴백을 둬야
    // 호출부가 빈 말풍선을 걱정하지 않는다.
    guard !wantsSmallTalk, let destination = officeDestinationChatter(kind: kind) else {
        return officeSmallTalk(department: department, variant: seed)
    }
    return destination
}

// MARK: - 마주친 두 사람

/// 도착한 사람 옆에 이미 서 있는 대화 상대. 없으면 nil.
///
/// `others` 에는 **걸음이 끝나 자기 자리에 멈춘 배회자만** 넣는다. 걷는 중인 사람을 넣으면
/// 지나가는 중인 좌표로 짝이 맺혀, 답할 때는 이미 화면 반대편에 있다.
///
/// 여럿이면 가까운 쪽, 거리가 같으면 이름 순으로 고른다 — 딕셔너리 순회 순서에 결과가
/// 좌우되면 같은 배치에서 대화가 붙었다 안 붙었다 한다.
public func officeChatterPartner(
    arrivedAt: TilePoint,
    others: [(agentType: String, tile: TilePoint)],
    maxDistance: Int = officeChatterPartnerMaxDistance
) -> String? {
    others
        .map { (agentType: $0.agentType, distance: officeTileDistance(arrivedAt, $0.tile)) }
        .filter { $0.distance <= maxDistance }
        .sorted {
            $0.distance != $1.distance ? $0.distance < $1.distance : $0.agentType < $1.agentType
        }
        .first?
        .agentType
}

/// 마주친 두 사람이 주고받는 두 마디.
///
/// 부서 조합(6×6=36)마다 대사를 쓰지 않는다 — 화면에서 두 사람이 어느 방 사람인지는 이미
/// 좌석과 문패가 말하고, 오가는 말에서 읽히는 것은 "말을 걸었다" 는 사실 자체다.
public func officeChatterExchange(round: Int, seed: Int) -> (opener: String, reply: String) {
    let openers = ["바쁘세요?", "잘 돼가요?", "커피 한잔?", "그거 봤어요?", "오늘 어때요?"]
    let replies = ["거의 다 됐어요", "그럭저럭요", "좋죠", "아직이요", "이제 좀 풀려요"]
    // 두 풀의 길이가 같으면 같은 인덱스로 뽑아도 되지만, 서로 다른 회차 성분을 섞어야
    // 한쪽 풀이 늘어났을 때 짝이 굳지 않는다.
    return (
        openers[officeChatterIndex(seed, count: openers.count)],
        replies[officeChatterIndex(seed &+ round &+ 1, count: replies.count)]
    )
}

// MARK: - 보조

/// 사람 이름과 회차로 만드는 씨앗. 문자열 해시를 직접 접는 이유는 `String.hashValue` 가
/// 실행마다 다른 시드를 쓰기 때문이다 — 그걸로는 같은 화면이 재현되지 않는다.
public func officeChatterSeed(agentType: String, round: Int) -> Int {
    let folded = agentType.unicodeScalars.reduce(0) { accumulated, scalar in
        (accumulated &* 31 &+ Int(scalar.value)) & 0x00FF_FFFF
    }
    return abs((folded &+ round &* 7) % 1_000_003)
}

/// 음수 씨앗이 들어와도 배열 범위 안으로 감는다.
func officeChatterIndex(_ seed: Int, count: Int) -> Int {
    guard count > 0 else {
        return 0
    }
    return ((seed % count) + count) % count
}

/// 격자 위 두 칸 사이의 거리(체비쇼프). 대각선 이웃도 옆에 선 것으로 봐야, 가구 앞 통로에서
/// 어깨를 맞댄 두 사람이 "멀리 있다" 로 판정되지 않는다.
func officeTileDistance(_ left: TilePoint, _ right: TilePoint) -> Int {
    max(abs(left.x - right.x), abs(left.y - right.y))
}
