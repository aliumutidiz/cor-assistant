# Launch the official CLI interactively outside the application workspace.
# This does not enable the C.O.R. provider or certify operating-system isolation.
$ErrorActionPreference = 'Stop'
$corAgyBinary = Join-Path $env:LOCALAPPDATA 'agy\bin\agy.exe'
if (-not (Test-Path -LiteralPath $corAgyBinary)) {
    throw 'Install the official Antigravity CLI before running this script.'
}
$corLoginDirectory = Join-Path ([IO.Path]::GetTempPath()) 'cor-agy-login'
New-Item -ItemType Directory -Path $corLoginDirectory -Force | Out-Null
Push-Location -LiteralPath $corLoginDirectory
try {
    Write-Host 'Sign in through the official CLI browser flow. Do not paste credentials into C.O.R.'
    & $corAgyBinary
} finally {
    Pop-Location
}
