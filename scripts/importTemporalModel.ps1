param(
  [Parameter(Mandatory = $true)]
  [string]$GgufPath,

  [Parameter(Mandatory = $false)]
  [string]$ModelName = "qwen-temporal",

  [Parameter(Mandatory = $false)]
  [double]$Temperature = 0,

  [Parameter(Mandatory = $false)]
  [string]$ModelfilePath = ".\Modelfile.temporal"
)

$ResolvedGguf = (Resolve-Path $GgufPath).Path
$ResolvedModelfile = [System.IO.Path]::GetFullPath($ModelfilePath)

$modelfile = @"
FROM $ResolvedGguf
PARAMETER temperature $Temperature
"@

Set-Content -Path $ResolvedModelfile -Value $modelfile -Encoding UTF8

Write-Host "Creating Ollama model '$ModelName' from $ResolvedGguf"
ollama create $ModelName -f $ResolvedModelfile

Write-Host "Model created. Quick check:"
ollama list
