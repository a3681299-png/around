$ErrorActionPreference = 'Continue'
$r31Root = (Get-Location).Path
$r31Before = [IO.Path]::GetFullPath((Join-Path $r31Root '../r31-before'))
$env:PLAYWRIGHT_BROWSERS_PATH = 'C:\Users\sm787\GitHub-Projects\web-world-themes\.work\browsers'
$r31Runs = [Collections.Generic.List[object]]::new()
function Invoke-R31Check([string]$Name,[string]$Directory,[string]$Extension,[string[]]$Arguments) {
  $env:WW_TEST_EXTENSION_PATH = $Extension
  $env:PLAYWRIGHT_JSON_OUTPUT_NAME = Join-Path $r31Root ('.work/evidence/' + $Name + '.json')
  Push-Location -LiteralPath $Directory
  try {
    & npm @Arguments *> (Join-Path $r31Root ('.work/evidence/' + $Name + '.txt'))
    $r31Runs.Add([pscustomobject]@{Name=$Name;Directory=$Directory;Extension=$Extension;ExitCode=$LASTEXITCODE})
    $r31Runs | ConvertTo-Json | Set-Content (Join-Path $r31Root '.work/evidence/remaining-runs.json') -Encoding utf8
  } finally { Pop-Location }
}
$r31AfterExtension = Join-Path $r31Root '.work/r31-normal'
$r31BeforeExtension = Join-Path $r31Before '.work/r31-normal'
node .work/r31-tools/data-check.mjs *> .work/evidence/independent-data.txt
$env:WW_VRM_FILE = 'C:\Users\sm787\Desktop\ローポリモデル用\out\trusie.vrm'
$env:WW_VRMA_DIR = 'C:\Users\sm787\Desktop\ローポリモデル用\out\anim'
Invoke-R31Check 'unit-windows' $r31Root $r31AfterExtension @('run','test:unit','--','--reporter=list,json','--output=.work/r31-unit')
Remove-Item Env:WW_VRM_FILE,Env:WW_VRMA_DIR -ErrorAction SilentlyContinue
$r31VersionPattern = 'pick a card, preview|effect edits survive|three images group, move|1080p alpha WebM|import, paint actual frames'
Invoke-R31Check 'before-version-assertions' $r31Before $r31BeforeExtension @('run','test:e2e','--','tests/creator-editor.spec.ts','tests/effect-editor.spec.ts','tests/group-editor.spec.ts','tests/media2-editor.spec.ts','tests/motion-editor.spec.ts','--grep',$r31VersionPattern,'--reporter=list,json','--output=.work/r31-version-assertions')
$r31FlakePattern = 'binary worker rejects undecodable PNG|standalone Studio edits a real extension target|UI0-d rejects forged'
$r31FlakeArgs = @('run','test:e2e','--','tests/studio-transfer.spec.ts','tests/studio.spec.ts','tests/ui0d-verification.spec.ts','--grep',$r31FlakePattern,'--repeat-each=10','--reporter=list,json','--output=.work/r31-flakes')
Invoke-R31Check 'before-flakes' $r31Before $r31BeforeExtension $r31FlakeArgs
Invoke-R31Check 'after-flakes' $r31Root $r31AfterExtension $r31FlakeArgs
$env:WW_R31_LIVE = '1'
$env:R31_VISUAL_PROBE = '0'
$r31LiveArgs = @('run','test:e2e','--','--config=.work/r31-tools/config.ts','live-visual.spec.ts','--reporter=list,json','--output=.work/r31-live-normal-final-private')
Invoke-R31Check 'live-normal-final' $r31Root $r31AfterExtension $r31LiveArgs
$env:R31_VISUAL_PROBE = '1'
Invoke-R31Check 'live-probe-final' $r31Root $r31AfterExtension $r31LiveArgs
$env:R31_VISUAL_PROBE = '0'
Invoke-R31Check 'sidepanel-visual-final' $r31Root $r31AfterExtension @('run','test:e2e','--','--config=.work/r31-tools/config.ts','sidepanel-visual.spec.ts','--reporter=list,json','--output=.work/r31-sidepanel-private')
Invoke-R31Check 'extra-final' $r31Root $r31AfterExtension @('run','test:e2e','--','--config=.work/r31-tools/config.ts','extra.spec.ts','--reporter=list,json','--output=.work/r31-public-extra-final')
$r31Runs | Format-Table
