import Foundation

public struct ApexlineBridgeEnvelope<Payload: Codable & Sendable>: Codable, Sendable {
    public let type: String
    public let alert: Payload?
    public let heartbeat: ApexlineBridgeHeartbeat?
    public let clear: ApexlineBridgeClear?

    public init(type: String, alert: Payload? = nil, heartbeat: ApexlineBridgeHeartbeat? = nil, clear: ApexlineBridgeClear? = nil) {
        self.type = type
        self.alert = alert
        self.heartbeat = heartbeat
        self.clear = clear
    }
}

public struct ApexlineBridgeHeartbeat: Codable, Sendable {
    public let ttlSeconds: Int
    public let status: String

    public init(ttlSeconds: Int = 120, status: String = "Accessory notification bridge armed") {
        self.ttlSeconds = ttlSeconds
        self.status = status
    }
}

public struct ApexlineBridgeClear: Codable, Sendable {
    public let reason: String

    public init(reason: String = "Blitzer notification cleared") {
        self.reason = reason
    }
}

public struct ApexlineBlitzerAlert: Codable, Sendable {
    public let label: String
    public let distanceMeters: Double
    public let speedLimitKph: Int?
    public let ttlSeconds: Int
    public let source: String
    public let rawText: String

    public init(
        label: String,
        distanceMeters: Double,
        speedLimitKph: Int?,
        ttlSeconds: Int = 180,
        source: String = "accessory",
        rawText: String
    ) {
        self.label = label
        self.distanceMeters = distanceMeters
        self.speedLimitKph = speedLimitKph
        self.ttlSeconds = ttlSeconds
        self.source = source
        self.rawText = rawText
    }
}

public enum ApexlineBlitzerTextParser {
    public static func parse(sourceName: String, title: String?, subtitle: String?, body: String?) -> ApexlineBlitzerAlert? {
        let rawText = [sourceName, title, subtitle, body]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")

        guard isLikelyBlitzerAlert(rawText) else {
            return nil
        }

        guard let distanceMeters = parseDistanceMeters(rawText) else {
            return nil
        }

        return ApexlineBlitzerAlert(
            label: parseLabel(rawText),
            distanceMeters: distanceMeters,
            speedLimitKph: parseSpeedLimitKph(rawText),
            rawText: rawText
        )
    }

    private static func isLikelyBlitzerAlert(_ text: String) -> Bool {
        text.range(of: #"blitzer|speed\s*camera|radar|mobile\s*camera|red.?light|kontrolle"#, options: [.regularExpression, .caseInsensitive]) != nil
    }

    private static func parseLabel(_ text: String) -> String {
        if text.range(of: #"mobile|mobil"#, options: [.regularExpression, .caseInsensitive]) != nil {
            return "Mobile speed camera"
        }
        if text.range(of: #"red.?light|ampel"#, options: [.regularExpression, .caseInsensitive]) != nil {
            return "Red light camera"
        }
        return "Speed camera"
    }

    private static func parseDistanceMeters(_ text: String) -> Double? {
        guard let match = firstMatch(#"(\d+(?:[,.]\d+)?)\s*(km|m|mi|mile|miles|ft|feet)\b"#, in: text) else {
            return nil
        }

        let value = Double(match[1].replacingOccurrences(of: ",", with: ".")) ?? 0
        switch match[2].lowercased() {
        case "km":
            return value * 1000
        case "m":
            return value
        case "mi", "mile", "miles":
            return value * 1609.344
        case "ft", "feet":
            return value * 0.3048
        default:
            return nil
        }
    }

    private static func parseSpeedLimitKph(_ text: String) -> Int? {
        guard let match = firstMatch(#"(\d{2,3})\s*(km/h|kmh|kph|mph)\b"#, in: text) else {
            return nil
        }

        let value = Int(match[1]) ?? 0
        if match[2].lowercased() == "mph" {
            return Int((Double(value) * 1.609344).rounded())
        }
        return value
    }

    private static func firstMatch(_ pattern: String, in text: String) -> [String]? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
            return nil
        }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        guard let result = regex.firstMatch(in: text, range: range) else {
            return nil
        }

        return (0..<result.numberOfRanges).compactMap { index in
            guard let range = Range(result.range(at: index), in: text) else {
                return nil
            }
            return String(text[range])
        }
    }
}
