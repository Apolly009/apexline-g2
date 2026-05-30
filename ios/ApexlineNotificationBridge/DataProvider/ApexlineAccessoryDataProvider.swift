import AccessoryNotifications
import AccessoryTransportExtension
import ExtensionFoundation
import Foundation
import os.log

private let logger = Logger(subsystem: "com.romanseemann.apexline.notification-bridge", category: "DataProvider")

@available(iOS 26.5, *)
@main
struct ApexlineAccessoryDataProvider: AccessoryDataProvider {
    @AppExtensionPoint.Bind
    static var boundExtensionPoint: AppExtensionPoint {
        AppExtensionPoint.Identifier("com.apple.accessory-data-provider")
        AppExtensionPoint.Capabilities {
            NotificationsForwarding {
                BlitzerNotificationHandler()
            }
        }
    }
}

@available(iOS 26.5, *)
final class BlitzerNotificationHandler: NotificationsForwarding.AccessoryNotificationsHandler, @unchecked Sendable {
    private var session: NotificationsForwarding.Session?
    private let encoder = JSONEncoder()

    func didActivate(for session: NotificationsForwarding.Session) {
        self.session = session
        Task {
            await sendHeartbeat()
        }
    }

    func didInvalidate() {
        session = nil
    }

    func addNotification(_ notification: AccessoryNotification, alertingContext: AlertingContext) async throws -> Bool {
        guard let alert = parse(notification) else {
            return false
        }

        guard alertingContext.shouldAlert || alertingContext.isSuppressedByFocus else {
            return false
        }

        try await sendAlert(alert)
        return alertingContext.shouldAlert
    }

    func updateNotification(_ notification: AccessoryNotification) {
        guard let alert = parse(notification) else {
            return
        }

        Task {
            try? await sendAlert(alert)
        }
    }

    func removeNotification(identifier: AccessoryNotification.Identifier) {
        logger.info("Removed forwarded notification \(identifier.notificationIdentifier)")
    }

    func removeAllNotifications() {
        logger.info("Removed all forwarded notifications")
    }

    func messageHandler(_ message: TransportMessage) {
        logger.debug("Accessory message received: \(String(describing: message))")
    }

    private func parse(_ notification: AccessoryNotification) -> ApexlineBlitzerAlert? {
        ApexlineBlitzerTextParser.parse(
            sourceName: notification.sourceName,
            title: notification.title,
            subtitle: notification.subtitle,
            body: notification.body?.string
        )
    }

    private func sendHeartbeat() async {
        let envelope = ApexlineBridgeEnvelope<ApexlineBlitzerAlert>(
            type: "apexline.blitzer.heartbeat",
            heartbeat: ApexlineBridgeHeartbeat()
        )
        do {
            try await send(envelope)
        } catch {
            logger.error("Failed to send heartbeat: \(error.localizedDescription)")
        }
    }

    private func sendAlert(_ alert: ApexlineBlitzerAlert) async throws {
        let envelope = ApexlineBridgeEnvelope(
            type: "apexline.blitzer.alert",
            alert: alert
        )
        try await send(envelope)
    }

    private func send<Payload: Codable & Sendable>(_ envelope: ApexlineBridgeEnvelope<Payload>) async throws {
        guard let session else {
            logger.warning("Dropping bridge packet because the accessory session is inactive.")
            return
        }

        let data = try encoder.encode(envelope)
        try await session.send(message: AccessoryMessage {
            AccessoryMessage.Payload(transport: .bluetooth, data: data)
        })
    }
}
