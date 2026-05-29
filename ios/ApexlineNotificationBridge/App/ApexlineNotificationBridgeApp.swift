import SwiftUI

@available(iOS 26.5, *)
@main
struct ApexlineNotificationBridgeApp: App {
    @StateObject private var controller = AccessoryForwardingController()

    var body: some Scene {
        WindowGroup {
            BridgeStatusView()
                .environmentObject(controller)
        }
    }
}

@available(iOS 26.5, *)
struct BridgeStatusView: View {
    @EnvironmentObject private var controller: AccessoryForwardingController

    var body: some View {
        NavigationStack {
            List {
                Section("Bridge") {
                    Text(controller.status)
                    Text("Forwarding: \(controller.forwardingDecision.description)")
                }

                Section("Accessory") {
                    if controller.accessories.isEmpty {
                        Text("No accessory selected")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(controller.accessories, id: \.displayName) { accessory in
                            VStack(alignment: .leading) {
                                Text(accessory.displayName)
                                Text(String(describing: accessory.state))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }

                Section {
                    Button("Select G2 / relay accessory") {
                        controller.showPicker()
                    }
                    Button("Request Blitzer.de PRO notification forwarding") {
                        Task { await controller.requestForwarding() }
                    }
                    Button("Open forwarding settings") {
                        Task { await controller.openForwardingSettings() }
                    }
                    Button("Refresh status") {
                        Task { await controller.refreshForwardingStatus() }
                    }
                }
            }
            .navigationTitle("Apexline Bridge")
        }
    }
}
