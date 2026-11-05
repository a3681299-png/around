$ErrorActionPreference = 'Stop'
$env:WW_TEST_WINDOW_OFFSCREEN = '1'
$env:R31_PERF = '1'
$env:UI1_HOST_AUDIT = '1'
$env:R31_CAPTURE_MODEL_ERRORS = '1'
$env:R31_CALIBRATION = '1'
$env:R31_PERF_WORK = '.work/evidence/calibration'
$env:PLAYWRIGHT_JSON_OUTPUT_NAME = Join-Path (Get-Location).Path '.work/evidence/perf-calibration-test.json'
& npm run test:e2e -- --config=.work/verify-tools/perf-config.ts perf.spec.ts --reporter=list,json *> .work/evidence/perf-calibration.log
$verificationCalibrationExit = $LASTEXITCODE
Get-Content .work/evidence/perf-calibration.log -Tail 10
if ($verificationCalibrationExit -ne 0) { exit $verificationCalibrationExit }
$env:R31_CALIBRATION = '0'
$env:R31_PERF_WORK = '.work/evidence/performance'
$env:PLAYWRIGHT_JSON_OUTPUT_NAME = Join-Path (Get-Location).Path '.work/evidence/performance-test.json'
& npm run test:e2e -- --config=.work/verify-tools/perf-config.ts perf.spec.ts --reporter=list,json *> .work/evidence/performance.log
$verificationPerformanceExit = $LASTEXITCODE
Get-Content .work/evidence/performance.log -Tail 14
exit $verificationPerformanceExit
