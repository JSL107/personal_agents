import Foundation

@testable import ConsoleCore

private struct BriefingFixture: Decodable {
    struct TodoCase: Decodable {
        let name: String
        let todos: [ConsoleTodo]
        let expected: [String]
    }
    let presidentTodoLines: [TodoCase]
}

func runBriefingParityTests(_ t: TestRunner) {
    t.suite("BriefingFixture")
    let url = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .appendingPathComponent("fixtures/president-briefing.json")
    do {
        let fixture = try JSONDecoder().decode(BriefingFixture.self, from: Data(contentsOf: url))
        for testCase in fixture.presidentTodoLines {
            t.expectEqual(officePresidentTodoLines(todos: testCase.todos), testCase.expected, testCase.name)
        }
    } catch {
        t.fail("브리핑 대조표를 읽지 못했다: \(error)")
    }
}
