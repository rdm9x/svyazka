// svyazka-touchid — помощник Связки для Touch ID и связки ключей macOS.
//
//   svyazka-touchid "причина"                 подтвердить Touch ID (или паролем входа в Mac)
//   svyazka-touchid --store АККАУНТ           сохранить секрет из stdin в связку ключей
//   svyazka-touchid --load АККАУНТ "причина"  Touch ID → вывести секрет в stdout
//   svyazka-touchid --delete АККАУНТ          удалить секрет
//
// Коды выхода: 0 — успех, 1 — отказ или отмена, 2 — Touch ID недоступен / ошибка системы, 3 — секрета нет.
// Секрет — ключ хранилища (не мастер-пароль). Запись в связке ключей создаёт этот помощник,
// поэтому без вопросов её может прочитать только он; любой другой программе macOS покажет запрос доступа.

import Foundation
import LocalAuthentication
import Security

let service = "Svyazka"
let args = Array(CommandLine.arguments.dropFirst())

func verify(_ reason: String) -> Int32 {
  let ctx = LAContext()
  ctx.localizedCancelTitle = "Ввести пароль"
  var err: NSError?
  guard ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &err) else { return 2 }
  let sem = DispatchSemaphore(value: 0)
  var code: Int32 = 2
  ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason.isEmpty ? "открыть Связку" : reason) { ok, e in
    if ok { code = 0 }
    else if let e = e as? LAError {
      switch e.code {
      case .userCancel, .authenticationFailed, .userFallback, .appCancel: code = 1
      default: code = 2
      }
    }
    sem.signal()
  }
  if sem.wait(timeout: .now() + 120) == .timedOut { return 1 }
  return code
}

func query(_ account: String) -> [String: Any] {
  [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
}

func store(_ account: String) -> Int32 {
  let data = FileHandle.standardInput.readDataToEndOfFile()
  guard !data.isEmpty else { return 2 }
  SecItemDelete(query(account) as CFDictionary)
  var q = query(account)
  q[kSecValueData as String] = data
  q[kSecAttrLabel as String] = "Связка — ключ хранилища"
  q[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlocked
  return SecItemAdd(q as CFDictionary, nil) == errSecSuccess ? 0 : 2
}

func load(_ account: String, _ reason: String) -> Int32 {
  var probe = query(account)
  probe[kSecReturnAttributes as String] = true
  guard SecItemCopyMatching(probe as CFDictionary, nil) == errSecSuccess else { return 3 }
  let v = verify(reason)
  guard v == 0 else { return v }
  var q = query(account)
  q[kSecReturnData as String] = true
  var out: AnyObject?
  let st = SecItemCopyMatching(q as CFDictionary, &out)
  guard st == errSecSuccess, let data = out as? Data else { return st == errSecItemNotFound ? 3 : 2 }
  FileHandle.standardOutput.write(data)
  return 0
}

switch args.first {
case "--store": exit(args.count > 1 ? store(args[1]) : 2)
case "--load": exit(args.count > 1 ? load(args[1], args.count > 2 ? args[2] : "") : 2)
case "--delete": exit(args.count > 1 ? (SecItemDelete(query(args[1]) as CFDictionary) == errSecSuccess ? 0 : 3) : 2)
default: exit(verify(args.joined(separator: " ")))
}
