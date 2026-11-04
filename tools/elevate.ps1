param(
    [Parameter(Mandatory=$true)][string]$CodeExecutable,
    [Parameter(Mandatory=$true)][string]$AppRoot,
    [Parameter(Mandatory=$true)][string]$StateFolder,
    [Parameter(Mandatory=$true)][string]$ExtensionRoot,
    [Parameter(Mandatory=$true)][ValidateSet('apply','restore')][string]$Mode,
    [Parameter(Mandatory=$true)][string]$ResultFile
)
$ErrorActionPreference = 'Stop'
$env:ELECTRON_RUN_AS_NODE = '1'
& $CodeExecutable "$PSScriptRoot\maintenance.js" $AppRoot $StateFolder $ExtensionRoot $Mode $ResultFile
exit $LASTEXITCODE
