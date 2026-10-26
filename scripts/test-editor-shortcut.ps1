param(
  [Parameter(Mandatory = $true)][string]$OwnedProfile,
  [Parameter(Mandatory = $true)][string]$ExtensionPath,
  [Parameter(Mandatory = $true)][ValidateSet('E', 'Y', 'Q')][string]$Key
)
$ErrorActionPreference = 'Stop'
$work = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../.work'))
$profile = [IO.Path]::GetFullPath($OwnedProfile)
$extension = [IO.Path]::GetFullPath($ExtensionPath)
if ([IO.Path]::GetDirectoryName($profile) -ne $work -or [IO.Path]::GetFileName($profile) -notlike 'g-entry-profile-*' -or
    [IO.Path]::GetDirectoryName($extension) -ne $work -or [IO.Path]::GetFileName($extension) -notlike 'g-entry-extension-*') {
  throw 'Only the generated G entry test profile and extension copy may receive native keys.'
}
$profilePattern = [regex]::Escape("--user-data-dir=$profile") + '(?=["\s]|$)'
$extensionPattern = [regex]::Escape("--load-extension=$extension") + '(?=["\s]|$)'
$owned = @(Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" | Where-Object {
  $_.CommandLine -notlike '*--type=*' -and $_.CommandLine -match $profilePattern -and $_.CommandLine -match $extensionPattern
})
if ($owned.Count -ne 1) { throw 'Expected one owned test browser.' }
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class EntryTestKeys {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr window);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
}
'@
$window = (Get-Process -Id $owned[0].ProcessId).MainWindowHandle
if ($window -eq [IntPtr]::Zero) { throw 'Owned browser has no window.' }
[uint32]$ownedWindowPid = 0
$targetThread = [EntryTestKeys]::GetWindowThreadProcessId($window, [ref]$ownedWindowPid)
if ($ownedWindowPid -ne $owned[0].ProcessId) { throw 'Window no longer belongs to the owned browser.' }
[uint32]$foregroundWindowPid = 0
$foregroundThread = [EntryTestKeys]::GetWindowThreadProcessId([EntryTestKeys]::GetForegroundWindow(), [ref]$foregroundWindowPid)
$helperThread = [EntryTestKeys]::GetCurrentThreadId()
# Windows restricts cross-process foreground activation. Temporarily share the
# input queue to focus this verified test window, then detach before sending keys.
$attachedThreads = @($targetThread, $foregroundThread) | Where-Object { $_ -ne 0 -and $_ -ne $helperThread } | Select-Object -Unique
try {
  foreach ($thread in $attachedThreads) { [EntryTestKeys]::AttachThreadInput($helperThread, $thread, $true) | Out-Null }
  [EntryTestKeys]::ShowWindow($window, 9) | Out-Null
  [EntryTestKeys]::BringWindowToTop($window) | Out-Null
  [EntryTestKeys]::SetForegroundWindow($window) | Out-Null
  [EntryTestKeys]::SetFocus($window) | Out-Null
} finally {
  foreach ($thread in $attachedThreads) { [EntryTestKeys]::AttachThreadInput($helperThread, $thread, $false) | Out-Null }
}
for ($i = 0; $i -lt 50 -and [EntryTestKeys]::GetForegroundWindow() -ne $window; $i++) { Start-Sleep -Milliseconds 10 }
if ([EntryTestKeys]::GetForegroundWindow() -ne $window) { throw 'Refusing keys outside the owned test window.' }
$code = [byte][char]$Key
try {
  [EntryTestKeys]::keybd_event(18, 0, 0, [UIntPtr]::Zero)
  [EntryTestKeys]::keybd_event(16, 0, 0, [UIntPtr]::Zero)
  [EntryTestKeys]::keybd_event($code, 0, 0, [UIntPtr]::Zero)
} finally {
  [EntryTestKeys]::keybd_event($code, 0, 2, [UIntPtr]::Zero)
  [EntryTestKeys]::keybd_event(16, 0, 2, [UIntPtr]::Zero)
  [EntryTestKeys]::keybd_event(18, 0, 2, [UIntPtr]::Zero)
}
