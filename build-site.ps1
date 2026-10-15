# Gera a versão independente do Draw (site estático) a partir do arquivo do artifact.
param([string]$Src, [string]$Out)
$ErrorActionPreference = 'Stop'
$utf8 = New-Object Text.UTF8Encoding $false
$page = [IO.File]::ReadAllText($Src)

# Tudo antes de <div id="app"> (título, fontes, scripts de bibliotecas e CSS) vai para o <head>
$cut = $page.IndexOf('<div id="app">')
if ($cut -lt 0) { throw 'marcador <div id="app"> não encontrado' }
$headPart = $page.Substring(0, $cut).Trim()
$bodyPart = $page.Substring($cut).Trim()

$version = (Get-Date).ToString('yyyyMMddHHmm')
$html = @"
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="description" content="Draw: editor vetorial gratuito no navegador, com as ferramentas e os atalhos do CorelDRAW. Exporta PDF, SVG, EPS e PNG.">
<meta name="theme-color" content="#1a1f23">
<meta property="og:title" content="Draw — editor vetorial no navegador">
<meta property="og:description" content="Desenhe com as ferramentas e os atalhos do CorelDRAW direto no navegador. Exporta PDF, SVG, EPS e PNG.">
<meta property="og:type" content="website">
<meta property="og:image" content="icon-512.png">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="icon-192.png">
<link rel="manifest" href="manifest.webmanifest">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}img{max-width:100%}</style>
<script>window.__DRAW_SITE = true;</script>
$headPart
</head>
<body>
$bodyPart
<script>
// Funciona offline depois da primeira visita (só em https ou localhost)
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
</script>
</body>
</html>
"@
New-Item -ItemType Directory -Force $Out | Out-Null
[IO.File]::WriteAllText("$Out\index.html", $html, $utf8)

$icon = @'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#1a1f23"/>
  <circle cx="150" cy="150" r="46" fill="#00a0e3"/>
  <circle cx="262" cy="150" r="46" fill="#e5007e"/>
  <circle cx="150" cy="262" r="46" fill="#ffed00"/>
  <circle cx="262" cy="262" r="46" fill="#f5f6f7"/>
  <path d="M120 404c70-6 150-40 218-112 30-32 52-70 62-104" fill="none" stroke="#3cb4ee" stroke-width="30" stroke-linecap="round"/>
  <circle cx="404" cy="176" r="26" fill="#f5f6f7"/>
</svg>
'@
[IO.File]::WriteAllText("$Out\icon.svg", $icon, $utf8)

$manifest = @'
{
  "name": "Draw — editor vetorial",
  "short_name": "Draw",
  "description": "Editor vetorial no navegador com as ferramentas e os atalhos do CorelDRAW.",
  "lang": "pt-BR",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "background_color": "#111518",
  "theme_color": "#1a1f23",
  "icons": [
    { "src": "icon.svg", "sizes": "any", "type": "image/svg+xml" },
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
'@
[IO.File]::WriteAllText("$Out\manifest.webmanifest", $manifest, $utf8)

$sw = @"
// Cache para uso offline. Ao publicar uma versão nova, este número muda sozinho no build.
const CACHE = 'draw-$version';
const CORE = ['./', './index.html', './icon.svg', './icon-192.png', './icon-512.png', './manifest.webmanifest'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const url = new URL(r.url);
  if (url.origin === location.origin) {
    // páginas e arquivos do site: rede primeiro (pega atualizações), cache se estiver offline
    e.respondWith(fetch(r).then(res => { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); return res; }).catch(() => caches.match(r).then(m => m || caches.match('./index.html'))));
  } else if (/cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(url.host)) {
    // bibliotecas e fontes com versão fixa: cache primeiro
    e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); return res; })));
  }
});
"@
[IO.File]::WriteAllText("$Out\sw.js", $sw, $utf8)
"ok $version"
