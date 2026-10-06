[CmdletBinding()]
param(
  [string]$Token = "",
  [string]$Url = "",
  [string]$Profile = "",
  [switch]$Upgrade,
  [switch]$Resume
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if ([string]::IsNullOrWhiteSpace($Url)) {
  $Url = if ($env:USEJUNCTION_URL) { $env:USEJUNCTION_URL } else { "http://localhost:3001" }
}
$Url = $Url.TrimEnd("/")

function Test-LoopbackControlPlane([string]$ControlPlaneUrl) {
  try {
    $uri = [Uri]$ControlPlaneUrl
    return @("localhost", "127.0.0.1", "::1") -contains $uri.Host.ToLowerInvariant()
  } catch {
    return $false
  }
}

if ([string]::IsNullOrWhiteSpace($Profile)) {
  $Profile = if ($env:USEJUNCTION_PROFILE) { $env:USEJUNCTION_PROFILE } else { "default" }
}
if ($Profile -eq "default" -and (Test-LoopbackControlPlane $Url)) {
  $Profile = "test"
}

switch ($Profile) {
  "test" {
    $RootDir = Join-Path $HOME ".usejunction-test"
    $CliName = "usejunction-test.exe"
    $TaskName = "UseJunction Agent Test"
  }
  "default" {
    $RootDir = Join-Path $HOME ".usejunction"
    $CliName = "usejunction.exe"
    $TaskName = "UseJunction Agent"
  }
  default { throw "Unknown agent profile: $Profile (expected default or test)" }
}

$InstallDir = Join-Path $RootDir "bin"
$Binary = Join-Path $InstallDir $CliName
$ConfigPath = Join-Path $RootDir "config.json"
$RunnerPath = Join-Path $RootDir "run-agent.ps1"
$LogPath = Join-Path $RootDir "agent.log"
$ProfileArgs = if ($Profile -eq "test") { @("--profile", "test") } else { @() }

function Show-Usage {
  throw "Usage: install.ps1 [-Token <token> | -Upgrade | -Resume] [-Url <control-plane>]"
}

if ($Upgrade -and $Resume) {
  throw "-Upgrade and -Resume cannot be used together."
}
if (-not $Upgrade -and -not $Resume -and [string]::IsNullOrWhiteSpace($Token)) {
  Show-Usage
}
if ($Upgrade -and -not (Test-Path $ConfigPath)) {
  throw "No existing UseJunction enrollment found at $ConfigPath"
}
if ($Resume -and -not (Test-Path $ConfigPath)) {
  throw "Existing UseJunction enrollment not found at $ConfigPath; resume cannot safely re-enroll this device."
}

function Get-AgentArchitecture {
  $value = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
  switch ($value.ToUpperInvariant()) {
    "AMD64" { return "amd64" }
    "ARM64" { return "arm64" }
    default { throw "Unsupported Windows architecture: $value. UseJunction supports x64 and ARM64." }
  }
}

function Get-LatestVersion {
  try {
    $release = Invoke-RestMethod -UseBasicParsing -Uri "$Url/api/agent-releases/latest" -TimeoutSec 20
    $candidate = if ($release.manifest.version) { $release.manifest.version } else { $release.version }
    if ($candidate -and $candidate -match '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z]+([.-][0-9A-Za-z]+)*)?$') {
      return [string]$candidate
    }
  } catch {
    if ($Upgrade) { throw "No active agent release is available from $Url." }
  }
  if ($Upgrade) { throw "No active agent release is available from $Url." }
  return $Version
}

function Compare-SemVer([string]$Left, [string]$Right) {
  $leftCore = $Left.Split('-')[0].Split('.')
  $rightCore = $Right.Split('-')[0].Split('.')
  for ($i = 0; $i -lt 3; $i++) {
    $a = [int]$leftCore[$i]
    $b = [int]$rightCore[$i]
    if ($a -gt $b) { return 1 }
    if ($a -lt $b) { return -1 }
  }
  $leftPre = if ($Left.Contains('-')) { $Left.Substring($Left.IndexOf('-') + 1) } else { "" }
  $rightPre = if ($Right.Contains('-')) { $Right.Substring($Right.IndexOf('-') + 1) } else { "" }
  if ($leftPre -eq $rightPre) { return 0 }
  if (-not $leftPre) { return 1 }
  if (-not $rightPre) { return -1 }
  return [string]::CompareOrdinal($leftPre, $rightPre)
}

function Download-Agent([string]$Base, [string]$Name, [string]$Destination, [string]$TempDir) {
  $checksumPath = Join-Path $TempDir ("checksums-" + [Guid]::NewGuid().ToString("N") + ".txt")
  Invoke-WebRequest -UseBasicParsing -Uri "$Base/$Name" -OutFile $Destination -TimeoutSec 120
  Invoke-WebRequest -UseBasicParsing -Uri "$Base/checksums.txt" -OutFile $checksumPath -TimeoutSec 30
  $escaped = [Regex]::Escape($Name)
  $line = Get-Content $checksumPath | Where-Object { $_ -match "^([a-fA-F0-9]{64})\s+$escaped$" } | Select-Object -First 1
  if (-not $line) { throw "Checksum for $Name was not found." }
  $expected = ([Regex]::Match($line, '^([a-fA-F0-9]{64})')).Groups[1].Value.ToLowerInvariant()
  $actual = (Get-FileHash -Algorithm SHA256 -Path $Destination).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { throw "Agent checksum verification failed." }
}

function Stop-AgentTask {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($task) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 750
  }
}

function Install-AgentBinary([string]$Source) {
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  $staged = "$Binary.new"
  $previous = "$Binary.previous"
  Copy-Item -Force $Source $staged
  if (Test-Path $previous) { Remove-Item -Force $previous }
  if (Test-Path $Binary) { Move-Item -Force $Binary $previous }
  try {
    Move-Item -Force $staged $Binary
  } catch {
    if ((Test-Path $previous) -and -not (Test-Path $Binary)) { Move-Item -Force $previous $Binary }
    throw
  }
}

function Add-AgentToPath {
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $parts = @($userPath -split ';' | Where-Object { $_ })
  if (-not ($parts | Where-Object { $_.TrimEnd('\') -ieq $InstallDir.TrimEnd('\') })) {
    $next = if ($userPath) { "$userPath;$InstallDir" } else { $InstallDir }
    [Environment]::SetEnvironmentVariable("Path", $next, "User")
  }
  if (-not (($env:Path -split ';') | Where-Object { $_.TrimEnd('\') -ieq $InstallDir.TrimEnd('\') })) {
    $env:Path = "$env:Path;$InstallDir"
  }
}

function Show-CliInstructions {
  Write-Host ""
  if ($Profile -eq "test") {
    Write-Host "UseJunction test agent installed. Admin panel: $Url"
  } else {
    Write-Host "UseJunction installed. Admin panel: $Url"
  }
  Write-Host "CLI: $Binary"
  Write-Host "Next: open a new terminal, or run: `$env:Path = `"`$env:Path;$InstallDir`""
  Write-Host "Then: $($CliName -replace '\.exe$','') status"
  Write-Host "The agent will also start automatically when you sign in to Windows."
  Write-Host "Rollback an update: $($CliName -replace '\.exe$','') update --rollback"
}

function Register-AgentTask {
  New-Item -ItemType Directory -Force -Path $RootDir | Out-Null
  $escapedBinary = $Binary.Replace("'", "''")
  $escapedLog = $LogPath.Replace("'", "''")
  $profileArg = if ($Profile -eq "test") { " --profile test" } else { "" }
  @"
`$ErrorActionPreference = "Continue"
& '$escapedBinary'$profileArg daemon *>> '$escapedLog'
exit `$LASTEXITCODE
"@ | Set-Content -Encoding UTF8 -Path $RunnerPath

  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$RunnerPath`""
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
  $principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "UseJunction coding telemetry agent" -Force | Out-Null
}

$Version = "0.1.0"
$Version = Get-LatestVersion
$Architecture = Get-AgentArchitecture
$Artifact = "usejunction-windows-$Architecture.exe"

if ($Upgrade -and (Test-Path $Binary)) {
  $statusArgs = @("status", "--format", "json") + $ProfileArgs
  $statusText = & $Binary @statusArgs 2>$null
  try { $current = ($statusText | ConvertFrom-Json).agentVersion } catch { $current = "" }
  if (-not $current) { throw "Could not determine the installed agent version; refusing an unverified upgrade." }
  $order = Compare-SemVer $Version $current
  if ($order -lt 0) { throw "Refusing to downgrade UseJunction from v$current to v$Version." }
  if ($order -eq 0) { Write-Host "UseJunction agent v$current is already installed."; exit 0 }
}

$repairInstall = (-not $Resume -or -not (Test-Path $Binary))
if ($Resume -and (Test-Path $Binary)) {
  $statusArgs = @("status", "--format", "json") + $ProfileArgs
  $statusText = & $Binary @statusArgs 2>$null
  try { $current = ($statusText | ConvertFrom-Json).agentVersion } catch { $current = "" }
  if (-not $current) {
    $repairInstall = $true
  } elseif ($current -notmatch '^0\.0\.0-dev\.' -and (Compare-SemVer $Version $current) -gt 0) {
    Write-Host "Refreshing the outdated agent from v$current to v$Version for setup recovery."
    $repairInstall = $true
  }
}

if ($repairInstall) {
  $TempDir = Join-Path ([IO.Path]::GetTempPath()) ("usejunction-" + [Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
  try {
    $downloadPath = Join-Path $TempDir $Artifact
    $bases = @()
    if ($env:USEJUNCTION_DOWNLOAD_BASE) { $bases += $env:USEJUNCTION_DOWNLOAD_BASE.TrimEnd('/') }
    $bases += "$Url/releases/download/v$Version"
    $bases += "https://github.com/Dinuda/usejunction/releases/download/agent-v$Version"
    $downloaded = $false
    foreach ($base in $bases) {
      try {
        Write-Host "Downloading UseJunction agent $Version for windows/$Architecture from $base..."
        Download-Agent $base $Artifact $downloadPath $TempDir
        $downloaded = $true
        break
      } catch {
        Write-Warning "Download from $base failed: $($_.Exception.Message)"
      }
    }
    if (-not $downloaded) { throw "Could not download a verified UseJunction Windows agent." }

    Stop-AgentTask
    Install-AgentBinary $downloadPath
    Add-AgentToPath
  } finally {
    Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue
  }
} else {
  Write-Host "Using existing UseJunction agent for setup recovery."
  Add-AgentToPath
}

if ($Upgrade) {
  Register-AgentTask
  Start-ScheduledTask -TaskName $TaskName
  Start-Sleep -Seconds 2
  & $Binary @($ProfileArgs + @("status"))
  Write-Host "UseJunction agent upgraded to v$Version."
  Write-Host "CLI: $Binary"
  Write-Host "Next: open a new terminal, or run: `$env:Path = `"`$env:Path;$InstallDir`""
  exit 0
}

if ($Resume) {
  Write-Host "Resuming UseJunction setup from the existing enrollment..."
  & $Binary @($ProfileArgs + @("setup"))
  $resumeFailed = $LASTEXITCODE -ne 0
  if ($resumeFailed) {
    Write-Warning "Initial sync is still incomplete; the background agent will keep retrying."
  }
  Register-AgentTask
  Start-ScheduledTask -TaskName $TaskName
  Start-Sleep -Seconds 2
  & $Binary @($ProfileArgs + @("status"))
  if ($resumeFailed) {
    throw "UseJunction setup recovery did not complete. Re-run this resume command after checking your network."
  }
  Write-Host "UseJunction setup resumed successfully."
  exit 0
}

$onboardFailed = $false
& $Binary @($ProfileArgs + @("onboard", "--token", $Token, "--url", $Url, "--accept-collection-notice"))
if ($LASTEXITCODE -ne 0) {
  if (-not (Test-Path $ConfigPath)) { throw "Device onboarding failed before enrollment completed." }
  $onboardFailed = $true
  Write-Warning "Device enrolled, but the first sync did not complete. The background agent will keep retrying."
}

Register-AgentTask
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 2
# Match the agent's step lines; [char] keeps the check mark intact in Windows PowerShell 5.
Write-Host ("  {0} Background agent  running (scheduled task, starts at sign-in)" -f [char]0x2713)
if ($onboardFailed) {
  throw "UseJunction was installed, but setup is incomplete. Re-run this installer with -Resume -Url '$Url'."
}
& $Binary @($ProfileArgs + @("onboard", "--complete"))
if ($LASTEXITCODE -ne 0) { Write-Warning "Could not print install summary." }
