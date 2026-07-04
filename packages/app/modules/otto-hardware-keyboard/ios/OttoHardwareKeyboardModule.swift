import ExpoModulesCore
import UIKit

private let hardwareSubmitEventName = "onHardwareKeyboardSubmit"

private weak var activeModule: OttoHardwareKeyboardModule?
private var isHardwareSubmitEnabled = false

@objc
public class OttoHardwareKeyboardReactDelegateHandler: ExpoReactDelegateHandler {
  public override func createRootViewController() -> UIViewController? {
    return OttoHardwareKeyboardRootViewController()
  }
}

public class OttoHardwareKeyboardModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OttoHardwareKeyboard")

    Events(hardwareSubmitEventName)

    OnCreate {
      activeModule = self
    }

    Function("setHardwareKeyboardSubmitEnabled") { (enabled: Bool) in
      DispatchQueue.main.async {
        isHardwareSubmitEnabled = enabled
      }
    }

    OnDestroy {
      if activeModule === self {
        activeModule = nil
      }
      isHardwareSubmitEnabled = false
    }
  }

  fileprivate func emitHardwareKeyboardSubmit() {
    sendEvent(hardwareSubmitEventName, [:])
  }
}

private final class OttoHardwareKeyboardRootViewController: UIViewController {
  override var keyCommands: [UIKeyCommand]? {
    guard isHardwareSubmitEnabled && UIDevice.current.userInterfaceIdiom == .pad else {
      return super.keyCommands
    }

    let command = UIKeyCommand(
      input: "\r",
      modifierFlags: [],
      action: #selector(handleHardwareKeyboardSubmit(_:))
    )
    if #available(iOS 15.0, *) {
      command.wantsPriorityOverSystemBehavior = true
    }
    return (super.keyCommands ?? []) + [command]
  }

  @objc
  private func handleHardwareKeyboardSubmit(_ sender: UIKeyCommand) {
    guard canSubmitCurrentTextInput() else {
      return
    }
    activeModule?.emitHardwareKeyboardSubmit()
  }

  private func canSubmitCurrentTextInput() -> Bool {
    guard let responder = UIResponder.ottoCurrentFirstResponder else {
      return false
    }
    guard let textInput = responder as? UITextInput else {
      return false
    }
    return textInput.markedTextRange == nil
  }
}

private extension UIResponder {
  private static weak var currentFirstResponder: UIResponder?

  static var ottoCurrentFirstResponder: UIResponder? {
    currentFirstResponder = nil
    UIApplication.shared.sendAction(
      #selector(captureCurrentFirstResponder(_:)),
      to: nil,
      from: nil,
      for: nil
    )
    return currentFirstResponder
  }

  @objc
  private func captureCurrentFirstResponder(_ sender: Any?) {
    UIResponder.currentFirstResponder = self
  }
}
