// Всё, что зависит от системы: окна ввода и подтверждения, проверка пользователя (Touch ID / Windows Hello),
// буфер обмена, открытие интерфейса, поиск исполняемого файла. macOS, Windows, Linux.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';

export const WIN = process.platform === 'win32';
export const MAC = process.platform === 'darwin';
export const LINUX = process.platform === 'linux';
export const OS_NAME = MAC ? 'macOS' : WIN ? 'Windows' : 'Linux';
export const VERIFY_NAME = MAC ? 'Touch ID' : WIN ? 'Windows Hello' : 'подтверждение';

const has = (cmd) => {
  const r = spawnSync(WIN ? 'where' : 'which', [cmd], { stdio: 'ignore' });
  return r.status === 0;
};

// Есть ли графический сеанс, где можно показать окно
export const GUI = !process.env.SVYAZKA_NO_GUI && (() => {
  if (MAC) {
    try { return spawnSync('launchctl', ['managername'], { encoding: 'utf8' }).stdout.trim() === 'Aqua'; } catch { return false; }
  }
  if (WIN) return !process.env.SSH_CONNECTION && !process.env.SSH_CLIENT;
  return !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY) && has('zenity');
})();

/* ── PowerShell (Windows) ── */

function ps(script, { env = {}, input, timeout = 180000 } = {}) {
  const pre = '[Console]::OutputEncoding=[Text.Encoding]::UTF8; [Console]::InputEncoding=[Text.Encoding]::UTF8;\n';
  const enc = Buffer.from(pre + script, 'utf16le').toString('base64');
  return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc],
    { env: { ...process.env, ...env }, input, encoding: 'utf8', timeout, windowsHide: true });
}

const PS_INPUT = `
Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$f = New-Object Windows.Forms.Form
$f.Text = 'Связка'; $f.ClientSize = New-Object Drawing.Size(460, 190); $f.StartPosition = 'CenterScreen'
$f.TopMost = $true; $f.FormBorderStyle = 'FixedDialog'; $f.MaximizeBox = $false; $f.MinimizeBox = $false
$f.Font = New-Object Drawing.Font('Segoe UI', 10)
$l = New-Object Windows.Forms.Label; $l.Text = $env:SV_TEXT; $l.SetBounds(16, 14, 428, 84)
$t = New-Object Windows.Forms.TextBox; $t.UseSystemPasswordChar = $true; $t.SetBounds(16, 104, 428, 28)
$ok = New-Object Windows.Forms.Button; $ok.Text = 'OK'; $ok.SetBounds(254, 146, 92, 30); $ok.DialogResult = 'OK'
$c = New-Object Windows.Forms.Button; $c.Text = 'Отмена'; $c.SetBounds(352, 146, 92, 30); $c.DialogResult = 'Cancel'
$f.AcceptButton = $ok; $f.CancelButton = $c; $f.Controls.AddRange(@($l, $t, $ok, $c))
$f.Add_Shown({ $f.Activate(); $t.Focus() })
if ($f.ShowDialog() -eq 'OK') { [Console]::Out.Write($t.Text) } else { exit 1 }`;

const PS_CONFIRM = `
Add-Type -AssemblyName System.Windows.Forms
$r = [Windows.Forms.MessageBox]::Show($env:SV_TEXT, 'Связка', 'YesNo', 'Warning', 'Button2', 'DefaultDesktopOnly')
if ($r -eq 'Yes') { exit 0 } else { exit 1 }`;

// Windows Hello через WinRT UserConsentVerifier. 0 — подтверждено, 1 — отказ, 2 — недоступно.
const PS_HELLO = `
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType = WindowsRuntime]
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
  function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $null = $task.Wait(-1); $task.Result }
  $a = Await ([Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()) ([Windows.Security.Credentials.UI.UserConsentVerifierAvailability])
  if ($a -ne 'Available') { exit 2 }
  $r = Await ([Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync($env:SV_TEXT)) ([Windows.Security.Credentials.UI.UserConsentVerificationResult])
  if ($r -eq 'Verified') { exit 0 } else { exit 1 }
} catch { exit 2 }`;

/* ── окна ── */

const asq = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

// Скрытый ввод (пароль). null — отмена.
export function dialogInput(text, title = 'Связка') {
  let r;
  if (MAC) {
    const script = `text returned of (display dialog ${asq(text)} with title ${asq(title)} default answer "" with hidden answer buttons {"Отмена", "OK"} default button "OK" cancel button "Отмена" with icon caution giving up after 180)`;
    r = spawnSync('osascript', ['-e', script], { encoding: 'utf8' });
  } else if (WIN) {
    r = ps(PS_INPUT, { env: { SV_TEXT: text } });
  } else {
    r = spawnSync('zenity', ['--entry', '--hide-text', '--title', title, '--text', text], { encoding: 'utf8', timeout: 180000 });
  }
  if (r.status !== 0) return null;
  const v = String(r.stdout || '').replace(/\r?\n$/, '');
  return v === '' ? null : v;
}

export function dialogConfirm(text) {
  if (MAC) {
    const script = `button returned of (display dialog ${asq('Разрешить: ' + text + '?')} with title "Связка" buttons {"Запретить", "Разрешить"} default button "Запретить" cancel button "Запретить" with icon caution giving up after 120)`;
    const r = spawnSync('osascript', ['-e', script], { encoding: 'utf8' });
    return r.status === 0 && r.stdout.trim() === 'Разрешить';
  }
  if (WIN) return ps(PS_CONFIRM, { env: { SV_TEXT: 'Разрешить: ' + text + '?' }, timeout: 120000 }).status === 0;
  return spawnSync('zenity', ['--question', '--title', 'Связка', '--text', 'Разрешить: ' + text + '?'], { timeout: 120000 }).status === 0;
}

// Проверка, что за компьютером владелец: 'ok' | 'denied' | 'unavailable'
export function verifyUser(reason, touchidHelper) {
  if (MAC && touchidHelper && fs.existsSync(touchidHelper)) {
    const r = spawnSync(touchidHelper, [reason], { stdio: 'ignore' });
    return r.status === 0 ? 'ok' : r.status === 2 ? 'unavailable' : 'denied';
  }
  if (WIN) {
    const r = ps(PS_HELLO, { env: { SV_TEXT: reason }, timeout: 120000 });
    return r.status === 0 ? 'ok' : r.status === 1 ? 'denied' : 'unavailable';
  }
  return 'unavailable';
}

/* ── буфер обмена ── */

export function clipboardSet(text) {
  if (MAC) return spawnSync('pbcopy', { input: text }).status === 0;
  if (WIN) {
    const script = text === ''
      ? 'Add-Type -AssemblyName System.Windows.Forms; [Windows.Forms.Clipboard]::Clear()'
      : 'Set-Clipboard -Value ([Console]::In.ReadToEnd())';
    return ps(script, { input: text, timeout: 15000 }).status === 0;
  }
  if (process.env.WAYLAND_DISPLAY && has('wl-copy')) {
    return (text === '' ? spawnSync('wl-copy', ['--clear']) : spawnSync('wl-copy', { input: text })).status === 0;
  }
  if (has('xclip')) return spawnSync('xclip', ['-selection', 'clipboard'], { input: text }).status === 0;
  return false;
}

/* ── интерфейс ── */

// Windows: Edge в режиме приложения (отдельное окно без вкладок), иначе браузер по умолчанию
export function openUrl(url) {
  if (MAC) return spawnSync('open', [url]);
  if (WIN) {
    const edge = ['ProgramFiles(x86)', 'ProgramFiles', 'LOCALAPPDATA']
      .map((k) => process.env[k] && path.join(process.env[k], 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
      .find((p) => p && fs.existsSync(p));
    if (edge) { spawn(edge, [`--app=${url}`], { detached: true, stdio: 'ignore' }).unref(); return; }
    spawn('cmd.exe', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return;
  }
  spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
}

/* ── запуск команд ── */

// Windows: найти программу по PATH/PATHEXT. .cmd/.bat запускаются через cmd.exe (иначе Node их не запустит).
export function resolveSpawn(cmd, args, env) {
  if (!WIN || path.isAbsolute(cmd) && path.extname(cmd)) return [cmd, args, {}];
  const exts = (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.toLowerCase());
  const dirs = [process.cwd(), ...(env.PATH || env.Path || '').split(';')].filter(Boolean);
  let found = null;
  outer: for (const d of dirs) {
    for (const e of path.extname(cmd) ? [''] : exts) {
      const p = path.join(d, cmd + e);
      if (fs.existsSync(p)) { found = p; break outer; }
    }
  }
  if (!found) return [cmd, args, {}];
  if (/\.(cmd|bat)$/i.test(found)) {
    const q = (s) => (/[\s"&|<>^]/.test(s) ? '"' + String(s).replace(/"/g, '""') + '"' : s);
    return ['cmd.exe', ['/d', '/s', '/c', '"' + [found, ...args].map(q).join(' ') + '"'], { windowsVerbatimArguments: true }];
  }
  return [found, args, {}];
}

// Имена родительских процессов (для пометки «Claude» / «Codex» в журнале). На Windows — пусто.
export function parentNames(limit = 12) {
  if (WIN) return [];
  try {
    const rows = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,comm='], { encoding: 'utf8' }).stdout.trim().split('\n');
    const procs = new Map(rows.map((r) => { const m = r.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/); return m ? [+m[1], { ppid: +m[2], comm: m[3] }] : [0, null]; }));
    const out = [];
    for (let pid = process.ppid, i = 0; pid > 1 && i < limit; i++) {
      const pr = procs.get(pid);
      if (!pr) break;
      out.push(path.basename(pr.comm).toLowerCase());
      pid = pr.ppid;
    }
    return out;
  } catch { return []; }
}

// Папка по умолчанию для sync: iCloud Drive (Mac), OneDrive (Windows), иначе Документы
export function defaultSyncDir(home) {
  const icloud = path.join(home, 'Library/Mobile Documents/com~apple~CloudDocs');
  if (MAC && fs.existsSync(icloud)) return path.join(icloud, 'Связка');
  if (WIN && process.env.OneDrive && fs.existsSync(process.env.OneDrive)) return path.join(process.env.OneDrive, 'Связка');
  return path.join(home, 'Documents', 'Svyazka');
}

export const tmpdir = os.tmpdir();
