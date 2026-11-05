$ErrorActionPreference = 'Stop'
$env:WW_TEST_WINDOW_OFFSCREEN = '1'
foreach ($verificationSide in @('after','before')) {
  $verificationExtension = if ($verificationSide -eq 'after') { '.work/extension' } else { '../playground-v1-before/.work/extension' }
  $env:WW_TEST_EXTENSION_PATH = (Resolve-Path $verificationExtension).Path
  $env:VERIFY_LABEL = "final-$verificationSide"
  $env:PLAYWRIGHT_JSON_OUTPUT_NAME = Join-Path (Get-Location).Path ".work/evidence/anchor-final-$verificationSide.json"
  & npm run test:e2e -- --config=.work/verify-tools/config.ts live.spec.ts --reporter=list,json "--output=.work/evidence/anchor-final-$verificationSide-traces" *> ".work/evidence/anchor-final-$verificationSide.log"
  Get-Content ".work/evidence/anchor-final-$verificationSide.log" -Tail 4
}
Remove-Item Env:VERIFY_LABEL
$env:WW_LIVE_OPERATIONS = '1'
$env:WW_TEST_EXTENSION_PATH = (Resolve-Path ../playground-v1-before/.work/extension).Path
$env:PLAYWRIGHT_JSON_OUTPUT_NAME = Join-Path (Get-Location).Path '.work/evidence/operations-resume-before.json'
& npm run test:e2e -- tests/operation-live.spec.ts --repeat-each=3 --reporter=list,json --output=.work/evidence/operations-resume-before-traces *> .work/evidence/operations-resume-before.log
Get-Content .work/evidence/operations-resume-before.log -Tail 5
