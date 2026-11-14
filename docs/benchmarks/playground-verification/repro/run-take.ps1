$ErrorActionPreference = 'Stop'
$env:AROUND_TEST_WINDOW_OFFSCREEN = '1'
foreach ($verificationSide in @('after','before')) {
  $env:VERIFY_LABEL = $verificationSide
  $verificationExtension = if ($verificationSide -eq 'after') { '.work/extension' } else { '../playground-v1-before/.work/extension' }
  $env:AROUND_TEST_EXTENSION_PATH = (Resolve-Path $verificationExtension).Path
  $env:PLAYWRIGHT_JSON_OUTPUT_NAME = Join-Path (Get-Location).Path ".work/evidence/take-$verificationSide-tests.json"
  & npm run test:e2e -- --config=.work/verify-tools/config.ts take-live-extra.spec.ts --reporter=list,json "--output=.work/evidence/take-$verificationSide-traces" *> ".work/evidence/take-$verificationSide.log"
  Get-Content ".work/evidence/take-$verificationSide.log" -Tail 14
}
