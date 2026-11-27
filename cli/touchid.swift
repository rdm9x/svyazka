// svyazka-touchid "причина" — спрашивает Touch ID (или пароль входа в Mac).
// Код выхода: 0 — подтверждено, 1 — отказ/отмена, 2 — Touch ID недоступен.
import Foundation
import LocalAuthentication

let reason = CommandLine.arguments.dropFirst().joined(separator: " ")
let ctx = LAContext()
ctx.localizedCancelTitle = "Отмена"
var err: NSError?
let policy = LAPolicy.deviceOwnerAuthentication
guard ctx.canEvaluatePolicy(policy, error: &err) else { exit(2) }

let sem = DispatchSemaphore(value: 0)
var ok = false
ctx.evaluatePolicy(policy, localizedReason: reason.isEmpty ? "открыть секрет в Связке" : reason) { success, _ in
  ok = success
  sem.signal()
}
_ = sem.wait(timeout: .now() + 120)
exit(ok ? 0 : 1)
