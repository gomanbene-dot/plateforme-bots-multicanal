$ErrorActionPreference = 'Stop'
$botRoot = Split-Path -Parent $PSScriptRoot
$botMutex = New-Object System.Threading.Mutex($false, 'Local\YEWhatsAppStart673676864')
if (-not $botMutex.WaitOne(0)) { exit }
try {
    try {
        $botStatus = Invoke-RestMethod 'http://127.0.0.1:3191/status' -TimeoutSec 3
        if ($null -ne $botStatus.ready) { exit }
    } catch {}
    $nodePath = 'C:\Program Files\nodejs\node.exe'
    if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Node.js introuvable' }
    # A distinct linked-device session is required; never reuse the phone keys.
    $env:WA_DATA_DIR = Join-Path $botRoot '.private/whatsapp-pc'
    Start-Process -FilePath $nodePath -ArgumentList 'scripts/whatsapp-qr-pilot.mjs' -WorkingDirectory $botRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $botRoot '.private/whatsapp-pilot.log') -RedirectStandardError (Join-Path $botRoot '.private/whatsapp-pilot-error.log')
    Start-Sleep -Seconds 3
} finally {
    $botMutex.ReleaseMutex()
    $botMutex.Dispose()
}
