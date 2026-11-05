$ErrorActionPreference = 'Stop'
$env:WW_TEST_WINDOW_OFFSCREEN = '1'
$env:WW_TEST_EXTENSION_PATH = (Resolve-Path .work/extension).Path
$env:PLAYWRIGHT_JSON_OUTPUT_NAME = Join-Path (Get-Location).Path '.work/evidence/pg-normal-record.json'
& npm run test:e2e -- --config=.work/verify-tools/config.ts playground-extra.spec.ts --reporter=list,json --output=.work/evidence/pg-normal-record-traces *> .work/evidence/pg-normal-record.log
Get-Content .work/evidence/pg-normal-record.log -Tail 4
$env:PLAYWRIGHT_JSON_OUTPUT_NAME = Join-Path (Get-Location).Path '.work/evidence/fast-release.json'
$env:WW_TEST_EXTENSION_PATH = (Resolve-Path .work/fault-fast-release).Path
& npm run test:e2e -- --config=.work/verify-tools/config.ts timing.spec.ts --grep 'G1.2 ①②④' --reporter=list,json --output=.work/evidence/fast-release-traces *> .work/evidence/fast-release.log
Get-Content .work/evidence/fast-release.log -Tail 6
$env:WW_LIVE_OPERATIONS = '1'
$env:WW_LIVE_SIGNAL_TIMELINE = '1'
foreach ($verificationSide in @('after','before')) {
  $verificationExtension = if ($verificationSide -eq 'after') { '.work/extension' } else { '../playground-v1-before/.work/extension' }
  $env:WW_TEST_EXTENSION_PATH = (Resolve-Path $verificationExtension).Path
  $env:PLAYWRIGHT_JSON_OUTPUT_NAME = Join-Path (Get-Location).Path ".work/evidence/real-$verificationSide.json"
  & npm run test:e2e -- tests/operation-live.spec.ts tests/signal-timeline-live.spec.ts --reporter=list,json "--output=.work/evidence/real-$verificationSide-traces" *> ".work/evidence/real-$verificationSide.log"
  Get-Content ".work/evidence/real-$verificationSide.log" -Tail 6
  if (Test-Path .work/verification/signal-live.json) { Copy-Item .work/verification/signal-live.json ".work/evidence/signal-live-$verificationSide.json" -Force }
  if (Test-Path .work/verification/signal-live-failure.png) { Copy-Item .work/verification/signal-live-failure.png ".work/evidence/signal-live-$verificationSide.png" -Force }
}
