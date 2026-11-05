param([ValidateSet('calibrate','AA','AB','A-profile','B','B-quiet','B-mannequin','B-trusie','visual','sample','live','live-retry')][string]$Stage)
$ErrorActionPreference = 'Stop'
$env:WW_TEST_WINDOW_OFFSCREEN = '1'
$env:WW_TEST_EXTENSION_PATH = (Resolve-Path '.work/extension').Path
$verificationEvidence = (New-Item -ItemType Directory -Path '.work/verify-evidence' -Force).FullName

function Invoke-Check([string]$Name, [string[]]$Arguments) {
  $env:PLAYWRIGHT_JSON_OUTPUT_NAME = Join-Path $verificationEvidence "$Name-tests.json"
  $verificationLog = Join-Path $verificationEvidence "$Name.log"
  $reporter = @('--reporter=list,json', "--output=.work/verify-evidence/results-$Name")
  & npm run test:e2e -- @Arguments @reporter *> $verificationLog
  $result = $LASTEXITCODE
  Get-Content $verificationLog -Tail 10 | Out-Host
  return $result
}

$custom = '--config=.work/verify/config.ts'
if ($Stage -eq 'B') {
  $verified = $true
  foreach ($scene in @('B-trusie','B-mannequin','B-quiet')) {
    $env:CHUNK2_STAGE = $scene
    $env:UI1_HOST_AUDIT = '1'
    if ((Invoke-Check "perf-$scene" @($custom,'perf.spec.ts')) -ne 0) { $verified = $false }
  }
  if ($verified) { exit 0 } else { exit 1 }
}
if ($Stage -in @('calibrate','AA','AB','A-profile','B-quiet','B-mannequin','B-trusie')) {
  $env:CHUNK2_STAGE = $Stage
  if ($Stage -eq 'A-profile') { $env:CHUNK2_PROFILE = '1' }
  if ($Stage -ne 'calibrate') { $env:UI1_HOST_AUDIT = '1' }
  exit (Invoke-Check "perf-$Stage" @($custom, 'perf.spec.ts'))
}

if ($Stage -eq 'visual') {
  $normal = Invoke-Check 'pg-normal' @($custom,'playground.spec.ts')
  $env:CHUNK2_FAULT = 'underlay'
  $underlay = Invoke-Check 'pg-underlay' @($custom,'playground.spec.ts','--grep','room-only')
  $env:CHUNK2_FAULT = 'clip'
  $clip = Invoke-Check 'pg-clip' @($custom,'playground.spec.ts','--grep','overlapping mannequin')
  Remove-Item Env:CHUNK2_FAULT
  if ($normal -ne 0 -or $underlay -eq 0 -or $clip -eq 0) { exit 1 }
  exit 0
}

if ($Stage -eq 'sample') {
  $testPaths = @('tests/operation-controls.spec.ts','tests/backup.spec.ts','tests/vrma-import.spec.ts','tests/legacy-data.spec.ts')
  $head = Invoke-Check 'switch-head' $testPaths
  Push-Location '../verify-chunk2-fix'
  try {
    $env:WW_TEST_EXTENSION_PATH = (Resolve-Path '.work/extension').Path
    $fix = Invoke-Check 'switch-fix' $testPaths
  } finally { Pop-Location }
  if ($head -or $fix) { exit 1 }
  exit 0
}

if ($Stage -eq 'live') {
  $env:WW_LIVE_R32 = '1'
  $r32 = Invoke-Check 'r32-live-head' @('tests/r32-live.spec.ts')
  $env:CHUNK2_LIVE_SIDE = 'head'
  $g1Head = Invoke-Check 'g1-live-head' @($custom,'live-g1.spec.ts')
  $env:WW_LIVE_OPERATIONS = '1'
  $env:WW_TEST_EXTENSION_PATH = (Resolve-Path '../verify-chunk2-fix/.work/extension').Path
  $env:CHUNK2_LIVE_SIDE = 'fix'
  $g1Fix = Invoke-Check 'g1-live-fix' @($custom,'live-g1.spec.ts')
  $opFix = Invoke-Check 'operation-live-fix' @('tests/operation-live.spec.ts')
  $opFault = Invoke-Check 'operation-volume-fault' @($custom,'volume-fault.spec.ts')
  $env:WW_TEST_EXTENSION_PATH = (Resolve-Path '.work/extension').Path
  $opHead = Invoke-Check 'operation-live-head' @('tests/operation-live.spec.ts')
  if ($r32 -or $g1Head -or $g1Fix -or $opFix -or $opHead -or $opFault -eq 0) { exit 1 }
  exit 0
}

if ($Stage -eq 'live-retry') {
  $env:CHUNK2_LIVE_SIDE = 'head'
  $g1Head = Invoke-Check 'g1-live-head-retry' @($custom,'live-g1.spec.ts')
  $env:WW_TEST_EXTENSION_PATH = (Resolve-Path '../verify-chunk2-fix/.work/extension').Path
  $env:CHUNK2_LIVE_SIDE = 'fix'
  $g1Fix = Invoke-Check 'g1-live-fix-retry' @($custom,'live-g1.spec.ts')
  $env:WW_LIVE_OPERATIONS = '1'
  $env:CHUNK2_VOLUME_FAULT = 'target'
  $opTarget = Invoke-Check 'operation-volume-target-fault' @($custom,'volume-fault.spec.ts')
  if ($g1Head -or $g1Fix -or $opTarget -eq 0) { exit 1 }
  exit 0
}
