# Связка — установка на Windows одним запуском:
#   команда svyazka, ярлык «Связка» в меню «Пуск», навык и правило для Claude Code и Codex.
# Хранилище (%USERPROFILE%\.svyazka\vault.json) не трогается: повторный запуск = обновление.
#   powershell -ExecutionPolicy Bypass -File install.ps1
$ErrorActionPreference = 'Stop'
function Ok($m) { Write-Host "✓ $m" -ForegroundColor Green }
function Warn($m) { Write-Host "! $m" -ForegroundColor Yellow }
function Die($m) { Write-Host "✗ $m" -ForegroundColor Red; exit 1 }

$Src = $PSScriptRoot
$Dir = Join-Path $HOME '.svyazka'
$App = Join-Path $Dir 'app'
$Bin = Join-Path $Dir 'bin'

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Die 'Нужен Node.js 20+: winget install OpenJS.NodeJS.LTS (или https://nodejs.org)' }
$major = [int](& node -p "process.versions.node.split('.')[0]")
if ($major -lt 20) { Die "Node.js $(& node -v) слишком старый — нужен 20+" }
Ok "Windows, Node.js $(& node -v) — есть"

# остановить старую версию, если была
if (Test-Path (Join-Path $App 'cli\svyazka.mjs')) { & node (Join-Path $App 'cli\svyazka.mjs') stop *> $null }

New-Item -ItemType Directory -Force -Path $Dir, $Bin | Out-Null
if ((Resolve-Path $Src).Path -ne $App) {
  $tmp = "$App.new"
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  Get-ChildItem -Force $Src | Where-Object { $_.Name -notin @('.git', 'dist', 'docs', '.github') } |
    Copy-Item -Destination $tmp -Recurse -Force
  if (Test-Path $App) { Remove-Item -Recurse -Force $App }
  Move-Item $tmp $App
}
Ok "файлы Связки — в $App"

# команда svyazka
Set-Content -Path (Join-Path $Bin 'svyazka.cmd') -Encoding ASCII -Value "@node `"%USERPROFILE%\.svyazka\app\cli\svyazka.mjs`" %*"
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not (($userPath -split ';') -contains $Bin)) {
  [Environment]::SetEnvironmentVariable('Path', ($(if ($userPath) { "$userPath;" } else { '' }) + $Bin), 'User')
  Ok 'команда svyazka добавлена в PATH (откройте новый терминал)'
} else { Ok 'команда svyazka — в PATH' }
$env:Path = "$env:Path;$Bin"

# ярлык в меню «Пуск»
# WScript.Shell не сохраняет ярлык с не-ASCII именем — сохраняем как Svyazka.lnk и переименовываем
$programs = [Environment]::GetFolderPath('Programs')
$lnk = Join-Path $programs 'Связка.lnk'
$tmpLnk = Join-Path $programs 'Svyazka.lnk'
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut($tmpLnk)
$s.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$s.Arguments = '"' + (Join-Path $App 'cli\win\svyazka-ui.vbs') + '"'
$s.IconLocation = (Join-Path $App 'icons\icon.ico') + ',0'
$s.Description = 'Связка — ключница для людей и ИИ-агентов'
$s.Save()
if (Test-Path -LiteralPath $lnk) { Remove-Item -LiteralPath $lnk -Force }
Move-Item -LiteralPath $tmpLnk -Destination $lnk
Ok 'ярлык «Связка» — в меню «Пуск» (можно закрепить на панели задач)'

# навык для Claude Code и Codex (копия: симлинки на Windows требуют прав)
foreach ($agent in @('.claude', '.codex')) {
  $root = Join-Path $HOME $agent
  if ($agent -eq '.codex' -and -not (Test-Path $root)) { continue }
  $dst = Join-Path $root 'skills\svyazka'
  if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
  New-Item -ItemType Directory -Force -Path $dst | Out-Null
  Copy-Item (Join-Path $App 'cli\skill\*') $dst -Recurse -Force
}
Ok "навык svyazka → ~\.claude\skills$(if (Test-Path (Join-Path $HOME '.codex')) { ' и ~\.codex\skills' })"

& node (Join-Path $App 'cli\agent-rules.mjs') install

$agentSvc = Get-Service ssh-agent -ErrorAction SilentlyContinue
if (-not $agentSvc) { Warn 'OpenSSH не найден — svyazka ssh не будет работать (Параметры → Приложения → Дополнительные компоненты → Клиент OpenSSH)' }
elseif ($agentSvc.StartType -eq 'Disabled' -or $agentSvc.Status -ne 'Running') {
  Warn 'служба ssh-agent выключена — для svyazka ssh в PowerShell от администратора:'
  Write-Host '    Get-Service ssh-agent | Set-Service -StartupType Automatic; Start-Service ssh-agent'
}

if (Test-Path (Join-Path $Dir 'vault.json')) { Ok 'хранилище уже есть — данные не тронуты' }
else { Write-Host "`nДальше: создать хранилище —  svyazka init   (или svyazka import <бэкап>)" }
