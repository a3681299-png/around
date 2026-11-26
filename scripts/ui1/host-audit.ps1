param([int]$OwnerPid, [int]$DurationMs = 10000)
$ErrorActionPreference = 'Stop'
$processes = @{}
Get-CimInstance Win32_Process | ForEach-Object { $processes[[int]$_.ProcessId] = $_ }
function Is-ChildOf([int]$ChildId, [int]$AncestorId) {
  $visited = @{}
  while ($ChildId -gt 0 -and -not $visited.ContainsKey($ChildId)) {
    if ($ChildId -eq $AncestorId) { return $true }
    $visited[$ChildId] = $true
    if (-not $processes.ContainsKey($ChildId)) { break }
    $ChildId = [int]$processes[$ChildId].ParentProcessId
  }
  return $false
}
$sessionPid = $OwnerPid
while ($processes.ContainsKey($sessionPid)) {
  $sessionProcess = $processes[$sessionPid]
  if ($sessionProcess.Name -eq 'codex.exe' -or ($sessionProcess.Name -eq 'claude.exe' -and $sessionProcess.ExecutablePath -match 'claude-code')) { break }
  $sessionPid = [int]$processes[$sessionPid].ParentProcessId
}
$before = @{}
Get-Process | ForEach-Object { $before[$_.Id] = [double]$_.CPU }
$started = [DateTimeOffset]::Now
$watch = [Diagnostics.Stopwatch]::StartNew()
Start-Sleep -Milliseconds $DurationMs
$after = @(Get-Process)
$watch.Stop()
$elapsed = $watch.Elapsed.TotalSeconds
$rows = @($after | ForEach-Object {
  if ($before.ContainsKey($_.Id)) {
    $spent = [math]::Max(0.0, [double]$_.CPU - $before[$_.Id])
    $entry = $processes[[int]$_.Id]
    [pscustomobject]@{
      Pid = $_.Id
      Name = $_.ProcessName
      CpuMs = [math]::Round(1000 * $spent, 3)
      OneCorePct = [math]::Round(100 * $spent / $elapsed, 3)
      Measurement = (Is-ChildOf $_.Id $OwnerPid)
      CurrentSession = (Is-ChildOf $_.Id $sessionPid)
      CodeSession = ($_.ProcessName -eq 'codex' -or ($_.ProcessName -eq 'claude' -and $entry.ExecutablePath -match 'claude-code'))
    }
  }
})
$logical = [Environment]::ProcessorCount
$background = @($rows | Where-Object { -not $_.Measurement })
$backgroundPercent = ($background | Measure-Object OneCorePct -Sum).Sum / $logical
$codeRoots = @($processes.Values | Where-Object {
  ($_.Name -eq 'codex.exe' -or ($_.Name -eq 'claude.exe' -and $_.ExecutablePath -match 'claude-code')) -and
  -not (Is-ChildOf ([int]$_.ProcessId) $sessionPid)
})
$otherCode = @(foreach ($codeRoot in $codeRoots) {
  $members = @($rows | Where-Object { Is-ChildOf $_.Pid ([int]$codeRoot.ProcessId) })
  [pscustomobject]@{
    Pid = [int]$codeRoot.ProcessId
    Name = $codeRoot.Name
    CpuMs = [math]::Round(($members | Measure-Object CpuMs -Sum).Sum, 3)
    OneCorePct = [math]::Round(($members | Measure-Object OneCorePct -Sum).Sum, 3)
    Processes = @($members | Sort-Object CpuMs -Descending | Select-Object -First 8)
  }
})
[pscustomobject]@{
  Started = $started.ToString('o')
  DurationMs = [math]::Round($watch.Elapsed.TotalMilliseconds, 3)
  LogicalProcessors = $logical
  OwnerPid = $OwnerPid
  CurrentSessionPid = $sessionPid
  BackgroundPercent = [math]::Round($backgroundPercent, 3)
  OtherCodeSessions = $otherCode
  TopBackground = @($background | Sort-Object CpuMs -Descending | Select-Object -First 12)
  CodeQuiet = (@($otherCode | Where-Object { $_.OneCorePct -gt 5 }).Count -eq 0)
  Quiet = ($backgroundPercent -le 5 -and @($otherCode | Where-Object { $_.OneCorePct -gt 5 }).Count -eq 0)
  Criterion = 'Background CPU <= 5% of all logical CPUs; each other code-session tree <= 5% of one core. No other tests/builds are launched during measurement.'
} | ConvertTo-Json -Depth 5 -Compress
