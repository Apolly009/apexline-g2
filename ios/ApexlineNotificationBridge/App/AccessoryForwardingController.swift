import AccessoryNotifications
import AccessorySetupKit
import SwiftUI
import UIKit

@available(iOS 26.5, *)
@MainActor
final class AccessoryForwardingController: ObservableObject {
    @Published private(set) var accessories: [ASAccessory] = []
    @Published private(set) var forwardingDecision: ForwardingDecision = .undetermined
    @Published var status: String = "Select the Even G2 or relay accessory."

    private let accessorySession = ASAccessorySession()
    private let notificationCenter = AccessoryNotificationCenter()

    init() {
        accessorySession.activate(on: .main) { [weak self] event in
            Task { @MainActor in
                self?.handle(event)
            }
        }
    }

    deinit {
        accessorySession.invalidate()
    }

    func showPicker() {
        let descriptor = ASDiscoveryDescriptor()
        descriptor.bluetoothNameSubstring = "Even"
        descriptor.bluetoothNameSubstringCompareOptions = [.caseInsensitive]
        descriptor.bluetoothRange = .default

        let item = ASPickerDisplayItem(
            name: "Even Realities G2",
            productImage: UIImage(systemName: "eyeglasses") ?? UIImage(),
            descriptor: descriptor
        )
        item.setupOptions = [.finishInApp]

        accessorySession.showPicker(for: [item]) { [weak self] error in
            Task { @MainActor in
                self?.status = error.map { "Picker failed: \($0.localizedDescription)" } ?? "Accessory picker closed."
            }
        }
    }

    func requestForwarding() async {
        guard let accessory = accessories.first(where: { $0.state == .authorized }) ?? accessories.first else {
            status = "No authorized accessory selected."
            return
        }

        do {
            forwardingDecision = try await notificationCenter.requestForwarding(for: accessory)
            status = "Forwarding decision: \(forwardingDecision.description)"
        } catch {
            status = "Forwarding request failed: \(error.localizedDescription)"
        }
    }

    func refreshForwardingStatus() async {
        guard let accessory = accessories.first(where: { $0.state == .authorized }) ?? accessories.first else {
            forwardingDecision = .undetermined
            return
        }

        do {
            forwardingDecision = try await notificationCenter.forwardingStatus(for: accessory)
            status = "Forwarding status: \(forwardingDecision.description)"
        } catch {
            status = "Forwarding status failed: \(error.localizedDescription)"
        }
    }

    func openForwardingSettings() async {
        guard let accessory = accessories.first(where: { $0.state == .authorized }) ?? accessories.first else {
            status = "No authorized accessory selected."
            return
        }

        do {
            forwardingDecision = try await notificationCenter.presentSettings(for: accessory)
            status = "Forwarding settings closed: \(forwardingDecision.description)"
        } catch {
            status = "Could not open forwarding settings: \(error.localizedDescription)"
        }
    }

    private func handle(_ event: ASAccessoryEvent) {
        accessories = accessorySession.accessories
        switch event.eventType {
        case .activated:
            status = accessories.isEmpty ? "No accessory selected." : "Accessory session ready."
        case .accessoryAdded, .accessoryChanged:
            status = event.accessory.map { "Accessory ready: \($0.displayName)" } ?? "Accessory updated."
        case .accessoryRemoved:
            status = "Accessory removed."
        case .pickerDidDismiss:
            status = accessories.isEmpty ? "No accessory selected." : "Accessory selected."
        case .pickerSetupFailed:
            status = event.error.map { "Accessory setup failed: \($0.localizedDescription)" } ?? "Accessory setup failed."
        default:
            break
        }
    }
}
