# Gera o Draw para Windows (Neutralino + WebView2) a partir do arquivo do editor.
param([string]$Src, [string]$App = (Split-Path $PSScriptRoot), [string]$Icon = (Join-Path $PSScriptRoot 'draw.png'))
if (-not $Src) { $Src = "$App\src\draw.html" }
$ErrorActionPreference = 'Stop'
$utf8 = New-Object Text.UTF8Encoding $false
$res = "$App\resources"

# bibliotecas locais: o programa funciona sem internet (só as fontes do Google precisam de conexão)
New-Item -ItemType Directory -Force "$res\lib" | Out-Null
$libs = @{
  'paper-core.min.js'  = 'https://cdnjs.cloudflare.com/ajax/libs/paper.js/0.12.17/paper-core.min.js'
  'jspdf.umd.min.js'   = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
  'svg2pdf.umd.min.js' = 'https://cdn.jsdelivr.net/npm/svg2pdf.js@2.2.3/dist/svg2pdf.umd.min.js'
  'opentype.min.js'    = 'https://cdnjs.cloudflare.com/ajax/libs/opentype.js/1.3.4/opentype.min.js'
}
foreach ($k in $libs.Keys) { if (-not (Test-Path "$res\lib\$k")) { Invoke-WebRequest $libs[$k] -OutFile "$res\lib\$k" -UseBasicParsing } }

$page = [IO.File]::ReadAllText($Src)
foreach ($k in $libs.Keys) { $page = $page.Replace($libs[$k], "lib/$k") }
$cut = $page.IndexOf('<div id="app">')
$headPart = $page.Substring(0, $cut).Trim(); $bodyPart = $page.Substring($cut).Trim()
$html = @"
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<script src="js/neutralino.js"></script>
<script>window.__DRAW_DESKTOP = true; try { Neutralino.init(); } catch (e) {}
// fechar a janela passa pelo Draw (pergunta se quer salvar); se o editor não carregou, fecha direto
try { Neutralino.events.on('windowClose', function () { if (window.__drawClose) window.__drawClose(); else Neutralino.app.exit(); }); window.__drawCloseHooked = true; } catch (e) {}</script>
$headPart
</head>
<body>
$bodyPart
</body>
</html>
"@
[IO.File]::WriteAllText("$res\index.html", $html, $utf8)
foreach ($f in 'styles.css', 'js\main.js', 'icons\logo.gif', 'icons\trayIcon.png') { if (Test-Path "$res\$f") { Remove-Item "$res\$f" } }
Copy-Item $Icon "$res\icons\appIcon.png" -Force

$cfg = [ordered]@{
  '$schema' = 'https://raw.githubusercontent.com/neutralinojs/neutralinojs/main/schemas/neutralino.config.schema.json'
  applicationId = 'com.draw.editor'; version = '1.0.0'; defaultMode = 'window'; port = 0
  documentRoot = '/resources/'; url = '/'; enableServer = $true; enableNativeAPI = $true; tokenSecurity = 'one-time'
  logging = [ordered]@{ enabled = $false; writeToLogFile = $false }
  nativeAllowList = @('app.*', 'os.*', 'filesystem.*', 'window.*')
  modes = [ordered]@{ window = [ordered]@{ title = 'Draw'; width = 1400; height = 880; minWidth = 900; minHeight = 600; center = $true; fullScreen = $false; alwaysOnTop = $false; icon = '/resources/icons/appIcon.png'; enableInspector = $false; borderless = $false; maximize = $true; hidden = $false; resizable = $true; exitProcessOnClose = $false } }
  cli = [ordered]@{ binaryName = 'Draw'; resourcesPath = '/resources/'; extensionsPath = '/extensions/'; clientLibrary = '/resources/js/neutralino.js'; binaryVersion = '6.10.0'; clientVersion = '6.10.0' }
}
[IO.File]::WriteAllText("$App\neutralino.config.json", ($cfg | ConvertTo-Json -Depth 6), $utf8)
"ok"
