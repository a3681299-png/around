# Windows PowerShell 5.1 turns redirected Node warnings into NativeCommandError records.
# Each native test's exit code, not its stderr warning stream, determines the expected failure.
$ErrorActionPreference = 'Continue'
$env:PLAYWRIGHT_BROWSERS_PATH = 'C:\Users\sm787\GitHub-Projects\web-world-themes\.work\browsers'
$root = (Get-Location).Path
$checks = @(
  @{ Fault='vrma'; File='.work/r31-tools/extra.spec.ts'; Pattern='malformed motion: mesh'; Config=$true },
  @{ Fault='clip'; File='tests/g14-idle-recheck.spec.ts'; Pattern='longer interval without a new drawing input'; Config=$false },
  @{ Fault='input'; File='tests/operation-editing-input.spec.ts'; Pattern='a covered control stops drawing until'; Config=$false },
  @{ Fault='approach'; File='tests/operation-safety.spec.ts'; Pattern='near a control, only the layer|a layer that moves onto a near control'; Config=$false },
  @{ Fault='hold'; File='tests/g13-look-regression.spec.ts'; Pattern='G1.3'; Config=$false }
)
$results = foreach ($check in $checks) {
  $env:WW_TEST_EXTENSION_PATH = '.work/r31-no-' + $check.Fault
  $env:PLAYWRIGHT_JSON_OUTPUT_NAME = Join-Path $root ('.work/evidence/mutant-' + $check.Fault + '.json')
  $arguments = @('run','test:e2e','--',$check.File,'--grep',$check.Pattern,'--reporter=list,json',('--output=.work/mutant-' + $check.Fault))
  if ($check.Config) { $arguments += '--config=.work/r31-tools/config.ts' }
  & npm @arguments *> ('.work/evidence/mutant-' + $check.Fault + '.txt')
  [pscustomobject]@{Fault=$check.Fault;Test=$check.File;Pattern=$check.Pattern;ExitCode=$LASTEXITCODE}
}
$results | ConvertTo-Json | Set-Content .work/evidence/browser-mutants.json -Encoding utf8
$results | Format-Table
