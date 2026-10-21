import Foundation

@testable import ConsoleCore

func runPresidentBriefingTests(_ t: TestRunner) {
    t.suite("PresidentBriefing")

    t.expect(officePresidentTodoLines(todos: []).isEmpty, "할 일이 없으면 말할 내용도 없다")
    let single = officePresidentTodoLines(todos: [
        ConsoleTodo(kind: .prReview, label: "PR 리뷰 회수 2건", detail: "10일째")
    ])
    t.expectEqual(single.first, "PR 리뷰 회수 2건 — 10일째", "한 건은 라벨과 상세를 말한다")

    let multiple = officePresidentTodoLines(todos: [
        ConsoleTodo(kind: .approval, label: "승인 3건", detail: "19:04 만료"),
        ConsoleTodo(kind: .failedRun, label: "PM 재시도", detail: "다음 실행은 내일"),
        ConsoleTodo(kind: .prReview, label: "PR 리뷰 회수 2건", detail: "10일째"),
    ])
    t.expectEqual(multiple.first, "승인 3건 — 19:04 만료 · 외 2건", "급한 첫 건과 남은 종류를 말한다")
    t.expect(multiple.count >= 2 && multiple[0].count > multiple[1].count, "후보는 긴 설명부터 짧아진다")
    t.expectEqual(multiple.last, "할 일 3가지", "최후 후보는 건수가 아닌 종류 수")
    let oneKind = officePresidentTodoLines(todos: [
        ConsoleTodo(kind: .prReview, label: "PR 리뷰 회수 6건", detail: "10일째")
    ])
    t.expectEqual(oneKind.last, "할 일 1가지", "한 종류 안의 여섯 건을 한 건으로 오인하지 않는다")

    let emptyStreak = ConsoleStreak(current: 0, best: 3, todayOpened: 0, todayRemaining: 0)
    t.expect(streakText(emptyStreak).contains("최고 3일"), "끊긴 상태에서도 최고 기록을 남긴다")
    t.expect(streakText(ConsoleStreak(current: 4, best: 4, todayOpened: 0, todayRemaining: 0)).contains("4일 연속"), "진행 중인 연속 일수")

    let legacyTodo = try? JSONDecoder().decode(
        ConsoleTodo.self,
        from: Data(#"{"kind":"FAILED_RUN","label":"PM 재시도","detail":"다음 실행은 내일"}"#.utf8)
    )
    t.expectEqual(legacyTodo?.targets, [], "targets 없는 응답은 빈 대상으로 받는다")
    let failedTodo = try? JSONDecoder().decode(
        ConsoleTodo.self,
        from: Data(
            #"""
            {"kind":"FAILED_RUN","label":"실패한 실행 2건 재시도","detail":"다음 실행은 내일",
             "targets":[{"label":"PM","agentType":"PM","runId":11,"retryable":true},
                        {"label":"VACATION","agentType":"VACATION","runId":12,"retryable":false}]}
            """#.utf8)
    )
    t.expectEqual(failedTodo?.targets.map(\.retryRunId), [11, nil], "지원 종류만 재시도 id 를 낸다")
    let reviewTodo = ConsoleTodo(
        kind: .prReview, label: "PR 리뷰 회수 2건", detail: "10일째",
        targets: [ConsoleTodoTarget(label: "o/r #994", pullNumber: 994, url: "https://github.com/o/r/pull/994")]
    )
    t.expectEqual(reviewTodo.targets.first?.retryRunId, nil, "PR 대상은 링크만 가진다")
    if let failedTodo {
        let todos = [reviewTodo, failedTodo]
        t.expectEqual(retryTarget(agentType: "PM", todos: todos)?.runId, 11, "담당자의 재시도 대상")
        t.expectNil(retryTarget(agentType: "VACATION", todos: todos), "미지원 종류는 재시도 불가")
        t.expectNil(retryTarget(agentType: "CEO", todos: todos), "목록에 없는 담당자는 재시도 대상이 없다")
    } else {
        t.expect(false, "대상이 실린 실패 할 일을 디코딩해야 한다")
    }
}
