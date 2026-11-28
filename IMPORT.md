# Import format

> **Moving from another password manager?** You don't need this format: `svyazka import` (or Settings → Import)
> reads exports from Bitwarden (`.json` without a password, `.csv`), 1Password (`.1pux`, `.csv`), KeePassXC (`.csv`)
> and Chrome / Edge / Firefox / Safari (`.csv`) directly. Folders and vaults become shelves; notes, hidden fields and
> 2FA secrets go into hidden fields; cards and identities are skipped. `svyazka export file.json|file.csv` exports back.

A plain (**unencrypted**) JSON for bulk-loading items: `svyazka import file.json` or the app → Settings → Import.
Items are **added** to the existing vault: shelves are matched by name (case-insensitive), duplicates
(same shelf + type + title) are skipped, so importing twice is safe.

> Delete the file right after importing — it contains secrets in plain text.
> If an agent builds this file, it must do so with a script that reads the source files itself and never prints values.

```json
{
  "format": "svyazka-import",
  "version": 1,
  "shelves": [
    {
      "name": "My VPS",
      "color": "#7aa2ff",
      "items": [
        { "type": "password", "title": "Hosting panel", "url": "https://panel.example.com", "login": "me@example.com", "password": "…", "note": "" },
        { "type": "ssh", "title": "root@vps", "host": "203.0.113.10", "user": "root", "port": "22",
          "privateKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n…\n-----END OPENSSH PRIVATE KEY-----", "publicKey": "ssh-ed25519 …", "passphrase": "", "note": "" },
        { "type": "token", "title": "Cloudflare API", "value": "…", "usage": "DNS for certbot", "expires": "2027-03-01", "note": "" },
        { "type": "token", "title": ".env prod", "value": "DB_PASS=…\nAPI_KEY=…", "usage": "docker compose" },
        { "type": "payment", "title": "VPS rent", "amount": "4.51", "currency": "EUR", "period": 1, "nextDate": "2026-12-05",
          "remind": 7, "autoRenew": true, "method": "Card •• 4421", "url": "https://panel.example.com", "note": "" },
        { "type": "note", "title": "Network", "text": "IP: …\nGateway: …" }
      ]
    }
  ]
}
```

| type | fields |
|---|---|
| `password` | `title`, `url`, `login`, `password`, `totp` (2FA secret), `note`, `hidden` |
| `ssh` | `title`, `host`, `user`, `port`, `privateKey`, `publicKey`, `passphrase`, `note`, `hidden` |
| `token` | `title`, `value` (a value or several `KEY=VALUE` lines — `svyazka run` exports each as an env var), `usage`, `expires` (YYYY-MM-DD), `note`, `hidden` |
| `payment` | `title`, `amount`, `currency` (ISO: USD, EUR, RUB…), `period` (months: 1, 3, 6, 12, 24, 36; 0 — one-off), `nextDate` (YYYY-MM-DD), `remind` (days), `autoRenew`, `method`, `url`, `note` |
| `note` | `title`, `text`, `hidden` |

`hidden` — hidden notes: shown only after Touch ID, never to agents (`note` and `text` are visible to agents).

- Shelf `color` is optional: `#7aa2ff #5fe0a8 #ffc266 #ff7eb6 #b18cff #5ad1f0 #ff8a5c #a3aec2`.
- Empty fields may be omitted; line breaks are `\n`; unknown fields are ignored; an item with no values is skipped.
- One shelf per service, project or server: everything about one VPS (root password, SSH key, panel, payment) together.
