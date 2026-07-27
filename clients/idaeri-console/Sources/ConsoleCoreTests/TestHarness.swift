import Foundation

/// CLT 전용 환경에는 XCTest 가 없어, 실행형 타깃으로 검증한다.
/// 실패를 수집했다가 마지막에 요약하고 exit code 로 pass/fail 을 낸다(`swift run ConsoleCoreTests`).
final class TestRunner {
    private var failures: [String] = []
    private var passed = 0
    private var currentSuite = ""

    func suite(_ name: String) {
        currentSuite = name
    }

    func expect(
        _ condition: Bool,
        _ message: @autoclosure () -> String,
        file: StaticString = #file,
        line: UInt = #line
    ) {
        if condition {
            passed += 1
            return
        }
        failures.append("[\(currentSuite)] \(message()) (\(file):\(line))")
    }

    func expectEqual<T: Equatable>(
        _ actual: T,
        _ expected: T,
        _ message: @autoclosure () -> String = "",
        file: StaticString = #file,
        line: UInt = #line
    ) {
        if actual == expected {
            passed += 1
            return
        }
        let label = message()
        let detail = label.isEmpty ? "" : "\(label): "
        failures.append("[\(currentSuite)] \(detail)기대 \(expected) 이나 실제 \(actual) (\(file):\(line))")
    }

    func expectNil(
        _ value: Any?,
        _ message: @autoclosure () -> String,
        file: StaticString = #file,
        line: UInt = #line
    ) {
        if value == nil {
            passed += 1
            return
        }
        failures.append("[\(currentSuite)] \(message()) — nil 을 기대했으나 값 존재 (\(file):\(line))")
    }

    func expectThrows(
        _ message: @autoclosure () -> String,
        file: StaticString = #file,
        line: UInt = #line,
        _ body: () throws -> Void
    ) {
        do {
            try body()
            failures.append("[\(currentSuite)] \(message()) — throw 를 기대했으나 성공 (\(file):\(line))")
        } catch {
            passed += 1
        }
    }

    func fail(_ message: String, file: StaticString = #file, line: UInt = #line) {
        failures.append("[\(currentSuite)] \(message) (\(file):\(line))")
    }

    func finish() -> Never {
        if failures.isEmpty {
            print("✅ 모든 검증 통과 (\(passed)건)")
            exit(0)
        }
        print("❌ \(failures.count)건 실패 / \(passed)건 통과")
        for failure in failures {
            print("  - \(failure)")
        }
        exit(1)
    }
}
