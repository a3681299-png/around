param([Parameter(Mandatory = $true)][string]$ProcessList)
$ErrorActionPreference = 'Stop'
if ($ProcessList -notmatch '^\d+(,\d+)*$') { throw 'Expected numeric browser process IDs.' }
$browserProcessIds = @($ProcessList.Split(',') | ForEach-Object { [int]$_ })
$gpuFilter = ($browserProcessIds | ForEach-Object { "Name LIKE 'pid_$($_)_luid_%'" }) -join ' OR '
$samples = @()
$timer = [Diagnostics.Stopwatch]::StartNew()
for ($sampleIndex = 0; $sampleIndex -lt 3; $sampleIndex++) {
  $engines = @(Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -Filter $gpuFilter |
    Select-Object Name, UtilizationPercentage)
  $memory = @(Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory -Filter $gpuFilter |
    Select-Object Name, DedicatedUsage, SharedUsage, TotalCommitted)
  $processMemory = @(Get-Process -Id $browserProcessIds -ErrorAction SilentlyContinue | Select-Object Id, PrivateMemorySize64, WorkingSet64)
  $samples += [PSCustomObject]@{ elapsedMs = $timer.ElapsedMilliseconds; engines = $engines; gpuMemory = $memory; processMemory = $processMemory }
  if ($sampleIndex -lt 2) { Start-Sleep -Milliseconds 300 }
}
[PSCustomObject]@{ source = 'Windows WDDM performance counters and Get-Process'; durationMs = $timer.ElapsedMilliseconds; samples = $samples } | ConvertTo-Json -Compress -Depth 6
