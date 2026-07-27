// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "IdaeriConsole",
    platforms: [.macOS(.v13)],
    targets: [
        .target(name: "ConsoleCore"),
        .executableTarget(
            name: "IdaeriConsole",
            dependencies: ["ConsoleCore"]
        ),
    ]
)
