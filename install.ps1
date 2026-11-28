# Связка — установка на Windows одним запуском:
#   команда svyazka, ярлык «Связка» в меню «Пуск», навык и правило для Claude Code и Codex.
# Хранилище (%USERPROFILE%\.svyazka\vault.json) не трогается: повторный запуск = обновление.
#
#   irm https://github.com/rdm9x/keyhandoff/releases/latest/download/install.ps1 -OutFile $env:TEMP\keyhandoff-install.ps1
#   powershell -ExecutionPolicy Bypass -File $env:TEMP\svyazka-install.ps1   # скачает релиз сам
#   powershell -ExecutionPolicy Bypass -File install.ps1      # из распакованного релиза или клона
#
# Если нет Node.js 20+, установщик скачает Node с nodejs.org (проверяет контрольную сумму) в ~\.svyazka\node —
# только для Связки, систему не трогает. Переменные: SVYAZKA_NODE=download, SVYAZKA_RELEASE_URL, SVYAZKA_NODE_DIST.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
function Ok($m) { Write-Host "✓ $m" -ForegroundColor Green }
function Warn($m) { Write-Host "! $m" -ForegroundColor Yellow }
# если скрипт запустили через iex, exit закрыл бы окно PowerShell — при скачивании ошибка выбрасывается
function Die($m) { Write-Host "✗ $m" -ForegroundColor Red; if ($script:Boot) { throw $m } else { exit 1 } }
# Язык сообщений: SVYAZKA_LANG → выбранный в Связке (config.json) → при обновлении русский → язык Windows
$script:IL = & {
  if ($env:SVYAZKA_LANG -in 'ru', 'en') { return $env:SVYAZKA_LANG }
  try { $c = (Get-Content -Raw (Join-Path $HOME '.svyazka\config.json') | ConvertFrom-Json).lang; if ($c -in 'ru', 'en') { return $c } } catch {}
  if (Test-Path (Join-Path $HOME '.svyazka\vault.json')) { return 'ru' }
  if ((Get-UICulture).Name -like 'ru*') { 'ru' } else { 'en' }
}
function M($ru, $en) { if ($script:IL -eq 'en') { $en } else { $ru } }
function First($file, $pattern) { $m = Select-String -Path $file -Pattern $pattern | Select-Object -First 1; if ($m) { $m.Matches[0].Value } }
function Fetch($url, $out) {
  if ($url -match '^file:') { Copy-Item -LiteralPath ([Uri]$url).LocalPath -Destination $out -Force }
  else { Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $out }
}
function Sum($file) { (Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLower() }
function SumFor($sums, $name) { foreach ($l in Get-Content $sums) { $p = $l -split '\s+'; if ($p.Count -ge 2 -and $p[1] -eq $name) { return $p[0].ToLower() } } }

$Src = $PSScriptRoot

# Запуск одной строкой (скачан только install.ps1): скачать последний релиз, проверить сумму, запустить его install.ps1
if (-not $Src -or -not (Test-Path (Join-Path $Src 'cli\svyazka.mjs'))) {
  $script:Boot = $true
  $rel = if ($env:SVYAZKA_RELEASE_URL) { $env:SVYAZKA_RELEASE_URL } else { 'https://github.com/rdm9x/keyhandoff/releases/latest/download' }
  $t = Join-Path ([IO.Path]::GetTempPath()) ('svyazka-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $t | Out-Null
  try {
    # репозиторий назывался rdm9x/svyazka: если нового адреса ещё нет — старый (после переименования GitHub перенаправляет сам)
    try { Fetch "$rel/SHA256SUMS.txt" "$t\SUMS" } catch {
      if ($env:SVYAZKA_RELEASE_URL) { throw }
      $rel = 'https://github.com/rdm9x/svyazka/releases/latest/download'
      Fetch "$rel/SHA256SUMS.txt" "$t\SUMS"
    }
    $zip = First "$t\SUMS" 'svyazka-[0-9][0-9.]*\.zip'
    if (-not $zip) { Die (M 'В SHA256SUMS.txt нет архива Связки' 'No Keyhandoff archive in SHA256SUMS.txt') }
    Fetch "$rel/$zip" "$t\$zip"
    if ((Sum "$t\$zip") -ne (SumFor "$t\SUMS" $zip)) { Die (M "Контрольная сумма $zip не совпала — не устанавливаю" "Checksum of $zip does not match — not installing") }
    Ok (M "скачан $zip, контрольная сумма совпала" "downloaded $zip, checksum OK")
    Expand-Archive -LiteralPath "$t\$zip" -DestinationPath $t -Force
    $env:SVYAZKA_LANG = $script:IL
    & powershell -NoProfile -ExecutionPolicy Bypass -File "$t\svyazka\install.ps1"
    if ($LASTEXITCODE) { throw (M "установка не удалась (код $LASTEXITCODE)" "installation failed (code $LASTEXITCODE)") }
  } finally { Remove-Item -Recurse -Force $t -ErrorAction SilentlyContinue }
  return
}

$Dir = Join-Path $HOME '.svyazka'
$App = Join-Path $Dir 'app'
$Bin = Join-Path $Dir 'bin'
New-Item -ItemType Directory -Force -Path $Dir, $Bin | Out-Null

function NodeOk($p) {
  if (-not $p -or -not (Test-Path -LiteralPath $p)) { return $false }
  # по выводу node -v: Windows PowerShell 5.1 теряет кавычки в аргументах программ, node -e с кодом ненадёжен
  try { $v = [string](& $p -v 2>$null); return ($v -match '^v(\d+)\.') -and ([int]$Matches[1] -ge 20) } catch { return $false }
}
$NodeDir = Join-Path $Dir 'node'
$node = $null
if ($env:SVYAZKA_NODE -ne 'download') {
  $c = Get-Command node -ErrorAction SilentlyContinue
  foreach ($p in @($(if ($c) { $c.Source }), (Join-Path $NodeDir 'node.exe'))) { if (NodeOk $p) { $node = $p; break } }
}
if ($node) { Ok "Node.js $(& $node -v) — $(M 'есть' 'found') ($node)" }
else {
  # свой Node: последняя версия LTS-ветки, сумма — из SHASUMS256.txt того же выпуска Node
  $dist = if ($env:SVYAZKA_NODE_DIST) { $env:SVYAZKA_NODE_DIST } else { 'https://nodejs.org/dist/latest-v24.x' }
  $plat = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'win-arm64' } else { 'win-x64' }
  $t = Join-Path ([IO.Path]::GetTempPath()) ('svyazka-node-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $t | Out-Null
  try {
    try { Fetch "$dist/SHASUMS256.txt" "$t\SUMS" } catch { Die (M "Не удалось скачать Node.js с $dist — проверьте интернет или поставьте Node.js 20+: winget install OpenJS.NodeJS.LTS" "Could not download Node.js from $dist — check the connection or install Node.js 20+: winget install OpenJS.NodeJS.LTS") }
    $f = First "$t\SUMS" "node-v[0-9.]*-$plat\.zip"
    if (-not $f) { Die (M "Не нашёл Node для $plat в $dist" "No Node for $plat in $dist") }
    $mark = Join-Path $NodeDir '.svyazka-node'
    if ((Test-Path $mark) -and ((Get-Content $mark -Raw).Trim() -eq $f) -and (NodeOk (Join-Path $NodeDir 'node.exe'))) {
      $node = Join-Path $NodeDir 'node.exe'
    } else {
      Write-Host (M "… Node.js 20+ не найден — скачиваю $f с nodejs.org (~30 МБ, только для Связки)" "… Node.js 20+ not found — downloading $f from nodejs.org (~30 MB, for Keyhandoff only)")
      Fetch "$dist/$f" "$t\$f"
      if ((Sum "$t\$f") -ne (SumFor "$t\SUMS" $f)) { Die (M "Контрольная сумма $f не совпала — не устанавливаю" "Checksum of $f does not match — not installing") }
      Expand-Archive -LiteralPath "$t\$f" -DestinationPath "$t\x" -Force
      if (Test-Path $NodeDir) { Remove-Item -Recurse -Force $NodeDir }
      Move-Item (Get-ChildItem "$t\x" | Select-Object -First 1).FullName $NodeDir
      Set-Content -Path $mark -Value $f -Encoding ASCII
      $node = Join-Path $NodeDir 'node.exe'
      if (-not (NodeOk $node)) { Die (M 'Скачанный Node не запускается' 'The downloaded Node does not run') }
    }
  } finally { Remove-Item -Recurse -Force $t -ErrorAction SilentlyContinue }
  Ok "Node.js $(& $node -v) — $(M 'свой, в ~\.svyazka\node' 'private copy in ~\.svyazka\node')"
}

# остановить старую версию, если была
if (Test-Path (Join-Path $App 'cli\svyazka.mjs')) { & $node (Join-Path $App 'cli\svyazka.mjs') stop *> $null }

New-Item -ItemType Directory -Force -Path $Dir, $Bin | Out-Null
if ((Resolve-Path $Src).Path -ne $App) {
  $tmp = "$App.new"
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  Get-ChildItem -Force $Src | Where-Object { $_.Name -notin @('.git', 'dist', 'docs', '.github', 'prebuilt') } |
    Copy-Item -Destination $tmp -Recurse -Force
  if (Test-Path $App) { Remove-Item -Recurse -Force $App }
  Move-Item $tmp $App
}
Ok "$(M 'файлы Связки — в' 'Keyhandoff files →') $App"

# команда svyazka
# полный путь к node: ярлык и агенты запускают svyazka без вашего PATH; путь в профиле — через %USERPROFILE% (файл в ASCII)
$nodeRef = if ($node.StartsWith($HOME, [StringComparison]::OrdinalIgnoreCase)) { '%USERPROFILE%' + $node.Substring($HOME.Length) } else { $node }
# keyhandoff, kh и svyazka — одна программа; svyazka остаётся навсегда (навык, правила, MCP-настройки)
foreach ($name in 'svyazka', 'keyhandoff', 'kh') {
  Set-Content -Path (Join-Path $Bin "$name.cmd") -Encoding ASCII -Value "@`"$nodeRef`" `"%USERPROFILE%\.svyazka\app\cli\svyazka.mjs`" %*"
}
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not (($userPath -split ';') -contains $Bin)) {
  [Environment]::SetEnvironmentVariable('Path', ($(if ($userPath) { "$userPath;" } else { '' }) + $Bin), 'User')
  Ok (M 'команды keyhandoff, kh и svyazka добавлены в PATH (откройте новый терминал)' 'keyhandoff, kh and svyazka commands added to PATH (open a new terminal)')
} else { Ok (M 'команды keyhandoff, kh и svyazka — в PATH' 'keyhandoff, kh and svyazka commands are in PATH') }
$env:Path = "$env:Path;$Bin"

# ярлык в меню «Пуск»
# WScript.Shell не сохраняет ярлык с не-ASCII именем — сохраняем как Keyhandoff.lnk и переименовываем
$programs = [Environment]::GetFolderPath('Programs')
$lnk = Join-Path $programs ((M 'Связка' 'Keyhandoff') + '.lnk')
foreach ($old in 'Связка.lnk', 'Svyazka.lnk', 'Keyhandoff.lnk') { $o = Join-Path $programs $old; if ($o -ne $lnk -and (Test-Path -LiteralPath $o)) { Remove-Item -LiteralPath $o -Force } }
$tmpLnk = Join-Path $programs 'Keyhandoff.lnk'
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut($tmpLnk)
$s.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$s.Arguments = '"' + (Join-Path $App 'cli\win\svyazka-ui.vbs') + '"'
$s.IconLocation = (Join-Path $App 'icons\icon.ico') + ',0'
$s.Description = M 'Связка — ключница для людей и ИИ-агентов' 'Keyhandoff — a keyring your AI agents use themselves'
$s.Save()
if ($lnk -ne $tmpLnk) {
  if (Test-Path -LiteralPath $lnk) { Remove-Item -LiteralPath $lnk -Force }
  Move-Item -LiteralPath $tmpLnk -Destination $lnk
}
Ok (M 'ярлык «Связка» — в меню «Пуск» (можно закрепить на панели задач)' 'Keyhandoff shortcut in the Start menu (can be pinned to the taskbar)')

# навык для Claude Code и Codex (копия: симлинки на Windows требуют прав)
foreach ($agent in @('.claude', '.codex')) {
  $root = Join-Path $HOME $agent
  if ($agent -eq '.codex' -and -not (Test-Path $root)) { continue }
  $dst = Join-Path $root 'skills\svyazka'
  if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
  New-Item -ItemType Directory -Force -Path $dst | Out-Null
  Copy-Item (Join-Path $App 'cli\skill\*') $dst -Recurse -Force
}
Ok "$(M 'навык svyazka' 'svyazka skill') → ~\.claude\skills$(if (Test-Path (Join-Path $HOME '.codex')) { ' + ~\.codex\skills' })"

# обновление: прежний интерфейс был только русским — закрепляем его, пока язык не выбрали явно
if (Test-Path (Join-Path $Dir 'vault.json')) { & $node (Join-Path $App 'cli\svyazka.mjs') config lang $script:IL --if-unset *> $null }
$env:SVYAZKA_LANG = $script:IL
& $node (Join-Path $App 'cli\agent-rules.mjs') install

$agentSvc = Get-Service ssh-agent -ErrorAction SilentlyContinue
if (-not $agentSvc) { Warn (M 'OpenSSH не найден — svyazka ssh не будет работать (Параметры → Приложения → Дополнительные компоненты → Клиент OpenSSH)' 'OpenSSH not found — svyazka ssh will not work (Settings → Apps → Optional features → OpenSSH Client)') }
elseif ($agentSvc.StartType -eq 'Disabled' -or $agentSvc.Status -ne 'Running') {
  Warn (M 'служба ssh-agent выключена — для svyazka ssh в PowerShell от администратора:' 'the ssh-agent service is off — for svyazka ssh, in an administrator PowerShell:')
  Write-Host '    Get-Service ssh-agent | Set-Service -StartupType Automatic; Start-Service ssh-agent'
}

if (Test-Path (Join-Path $Dir 'vault.json')) { Ok (M 'хранилище уже есть — данные не тронуты' 'vault already exists — data untouched') }
else { Write-Host ("`n" + (M 'Дальше: создать хранилище —  keyhandoff init   (или keyhandoff import <бэкап>)' 'Next: create the vault —  keyhandoff init   (or keyhandoff import <backup>)')) }
