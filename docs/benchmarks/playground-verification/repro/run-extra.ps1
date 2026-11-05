$ErrorActionPreference = 'Stop'
$env:WW_TEST_WINDOW_OFFSCREEN = '1'
$verificationRuns = @()
function Invoke-Verification([string]$Label, [string[]]$TestArguments, [string]$Extension = '.work/extension') {
  $env:WW_TEST_EXTENSION_PATH = (Resolve-Path $Extension).Path
  $env:PLAYWRIGHT_JSON_OUTPUT_NAME = Join-Path (Get-Location).Path ".work/evidence/$Label.json"
  $verificationArgs = $TestArguments + @('--reporter=list,json', "--output=.work/evidence/$Label-traces")
  & npm run test:e2e -- @verificationArgs *> ".work/evidence/$Label.log"
  $verificationStatus = $LASTEXITCODE
  $script:verificationRuns += @{ label = $Label; status = $verificationStatus; extension = $Extension; arguments = $TestArguments }
  $script:verificationRuns | ConvertTo-Json -Depth 8 | Set-Content .work/evidence/extra-runs.json -Encoding utf8
  Get-Content ".work/evidence/$Label.log" -Tail 4
}
Invoke-Verification 'pg-normal' @('--config=.work/verify-tools/config.ts', 'playground-extra.spec.ts')
if ($LASTEXITCODE -ne 0) { throw 'Normal Playground extra check failed; inspect before mutation tests.' }
$env:PG_REMOVE_MARK = '1'
Invoke-Verification 'pg-no-mark' @('--config=.work/verify-tools/config.ts', 'playground-extra.spec.ts', '--grep', 'missing mark')
Remove-Item Env:PG_REMOVE_MARK
$env:PG_BUILD = '.work/fault-parser'
Invoke-Verification 'pg-no-parser' @('--config=.work/verify-tools/config.ts', 'playground-extra.spec.ts', '--grep', 'malformed artwork')
$env:PG_BUILD = '.work/fault-clip'
Invoke-Verification 'pg-no-clip' @('--config=.work/verify-tools/config.ts', 'playground-extra.spec.ts', '--grep', 'overlapping character')
Remove-Item Env:PG_BUILD
Invoke-Verification 'stability-after' @('tests/operation-safety.spec.ts', 'tests/studio-transfer.spec.ts', '--grep', 'G1.2 ①②④|a binary message arriving after release', '--repeat-each=10')
Invoke-Verification 'stability-before' @('tests/operation-safety.spec.ts', 'tests/studio-transfer.spec.ts', '--grep', 'G1.2 ①②④|a binary message arriving after release', '--repeat-each=10') '../playground-v1-before/.work/extension'
Invoke-Verification 'no-hysteresis' @('--config=.work/verify-tools/config.ts', 'timing.spec.ts', '--grep', 'G1.2 ①②④', '--repeat-each=10') '.work/fault-hysteresis'
$env:VERIFY_LABEL = 'after'
Invoke-Verification 'live-after-final' @('--config=.work/verify-tools/config.ts', 'live.spec.ts')
$env:VERIFY_LABEL = 'before'
Invoke-Verification 'live-before' @('--config=.work/verify-tools/config.ts', 'live.spec.ts') '../playground-v1-before/.work/extension'
Remove-Item Env:VERIFY_LABEL
