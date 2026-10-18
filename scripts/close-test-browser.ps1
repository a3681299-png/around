param([Parameter(Mandatory = $true)][string]$OwnedProfile, [Parameter(Mandatory = $true)][string]$ExtensionPath, [long]$CloseRequestedAtUnixMs = 0)
$ErrorActionPreference = 'Stop'
if (-not [IO.Path]::IsPathRooted($OwnedProfile) -or -not [IO.Path]::IsPathRooted($ExtensionPath)) { throw 'Expected absolute test paths.' }
$profilePattern = [regex]::Escape("--user-data-dir=$OwnedProfile") + '(?=["\s]|$)'
$extensionPattern = [regex]::Escape("--load-extension=$ExtensionPath") + '(?=["\s]|$)'
$closeRequestedAt = if ($CloseRequestedAtUnixMs -gt 0) { [DateTimeOffset]::FromUnixTimeMilliseconds($CloseRequestedAtUnixMs).UtcDateTime } else { [DateTime]::UtcNow }
$owned = @(Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" | Where-Object {
  $_.CommandLine -like '*--headless*' -and $_.CommandLine -notlike '*--type=*' -and
  $_.CommandLine -match $profilePattern -and $_.CommandLine -match $extensionPattern -and $_.CreationDate.ToUniversalTime() -le $closeRequestedAt
})
foreach ($browserProcess in $owned) {
  & (Join-Path $env:SystemRoot 'System32/taskkill.exe') /PID $browserProcess.ProcessId /T /F | Out-Null
  if ($LASTEXITCODE -ne 0) {
    $remainingBrowser = Get-Process -Id $browserProcess.ProcessId -ErrorAction SilentlyContinue
    if ($remainingBrowser -and -not $remainingBrowser.WaitForExit(2000)) { throw 'Owned test browser did not exit.' }
  }
}
