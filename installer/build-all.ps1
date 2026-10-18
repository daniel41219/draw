# Gera tudo a partir de src\draw.html: programa (Windows/Linux/macOS), instalador, pacotes Linux e o site com o .zip para o cPanel.
# Uso: powershell -ExecutionPolicy Bypass -File installer\build-all.ps1
# Por padrão usa a pasta do repositório e gera o site em ..\draw-site (ao lado do repositório).
param([string]$App = (Split-Path $PSScriptRoot), [string]$Site = (Join-Path (Split-Path (Split-Path $PSScriptRoot)) 'draw-site'), [string]$Version = '1.0.0')
$ErrorActionPreference = 'Stop'
$inst = "$App\installer"; $tools = "$inst\tools\node_modules"
$src = "$App\src\draw.html"
if (-not (Test-Path $src)) { node "$inst\make-src.js" "$App\resources\index.html" $src; if ($LASTEXITCODE) { throw 'make-src' } }
if (-not (Test-Path $tools)) { throw "rode 'npm install' em $inst\tools antes" }

# 1. programa (resources/index.html + neutralino.config.json) e site (apresentação na raiz, editor em app\)
& "$inst\build-desktop.ps1" -Src $src -App $App -Icon "$inst\draw.png"
& "$inst\build-site.ps1" -Src $src -Out $Site
New-Item -ItemType Directory -Force "$Site\app\lib" | Out-Null
Copy-Item "$App\resources\lib\cdr-import.js" "$Site\app\lib\cdr-import.js" -Force
foreach ($i in 'icon-192.png', 'icon-512.png') { if (-not (Test-Path "$Site\app\$i")) { Copy-Item "$inst\draw.png" "$Site\app\$i" } }

# 2. binários do Neutralino com os arquivos embutidos (baixa o Neutralino na primeira vez)
Push-Location $App
try {
  if (-not (Test-Path "$App\bin") -or -not (Test-Path "$App\resources\js\neutralino.js")) { npx --yes @neutralinojs/neu@11 update; if ($LASTEXITCODE) { throw 'neu update' } }
  npx --yes @neutralinojs/neu@11 build --embed-resources; if ($LASTEXITCODE) { throw 'neu build' }
} finally { Pop-Location }

# 3. Windows: ícone e versão no .exe, versão portátil e instalador
$env:NODE_PATH = $tools
node "$inst\seticon.js" "$App\dist\Draw\Draw-win_x64.exe" "$inst\draw.png" "$inst\draw.ico"; if ($LASTEXITCODE) { throw 'seticon' }
New-Item -ItemType Directory -Force "$Site\downloads" | Out-Null
Copy-Item "$App\dist\Draw\Draw-win_x64.exe" "$Site\downloads\Draw-Windows.exe" -Force
& "$tools\innosetup-compiler\bin\ISCC.exe" /Q "/O$Site\downloads" "$inst\draw-setup.iss"; if ($LASTEXITCODE) { throw 'ISCC' }

# 4. Linux: .deb e .tar.gz
node "$inst\build-linux.js" "$App\dist\Draw\Draw-linux_x64" "$inst\draw.png" "$Site\downloads" $Version; if ($LASTEXITCODE) { throw 'linux' }

# 5. pacote do site para enviar ao cPanel
$zip = "$(Split-Path $Site)\draw-site.zip"
if (Test-Path $zip) { Remove-Item $zip }
# tar.exe do Windows grava os caminhos com "/" (o Compress-Archive usa "\" e o cPanel no Linux não cria as pastas)
Push-Location $Site
try { tar.exe -a -c -f $zip *; if ($LASTEXITCODE) { throw 'zip' } } finally { Pop-Location }
"pronto: $zip"
