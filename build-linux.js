// Monta os pacotes Linux do Draw sem precisar de Linux: .deb (Ubuntu/Debian/Mint) e .tar.gz com install.sh
// Uso: node build-linux.js <binário Draw-linux_x64> <ícone png> <pasta de saída> <versão>
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const [bin, icon, outDir, version = '1.0.0'] = process.argv.slice(2);
const MTIME = Math.floor(Date.now() / 1000);

// ---- tar (ustar) com permissões explícitas, porque o Windows não guarda bit de execução ----
function tarHeader({ name, size = 0, mode, type = '0', link = '' }) {
  const h = Buffer.alloc(512);
  const put = (s, off, len) => h.write(s, off, len, 'utf8');
  const oct = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0';
  let prefix = '';
  if (Buffer.byteLength(name) > 100) { const i = name.lastIndexOf('/', 154); prefix = name.slice(0, i); name = name.slice(i + 1); }
  put(name, 0, 100); put(oct(mode, 8), 100, 8); put(oct(0, 8), 108, 8); put(oct(0, 8), 116, 8);
  put(oct(size, 12), 124, 12); put(oct(MTIME, 12), 136, 12); put('        ', 148, 8); put(type, 156, 1); put(link, 157, 100);
  put('ustar\0', 257, 6); put('00', 263, 2); put('root', 265, 32); put('root', 297, 32); put(prefix, 345, 155);
  let sum = 0; for (const b of h) sum += b; put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return h;
}
function tar(entries) { // entries: {name, data?, mode, dir?, link?}
  const parts = [];
  for (const e of entries) {
    if (e.dir) { parts.push(tarHeader({ name: e.name.endsWith('/') ? e.name : e.name + '/', mode: e.mode ?? 0o755, type: '5' })); continue; }
    if (e.link) { parts.push(tarHeader({ name: e.name, mode: 0o777, type: '2', link: e.link })); continue; }
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    parts.push(tarHeader({ name: e.name, size: data.length, mode: e.mode ?? 0o644 }), data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(parts), { level: 9 });
}
// ---- ar (formato do .deb) ----
function ar(members) {
  const parts = [Buffer.from('!<arch>\n')];
  for (const [name, data] of members) {
    const h = `${name.padEnd(16)}${String(MTIME).padEnd(12)}${'0'.padEnd(6)}${'0'.padEnd(6)}${'100644'.padEnd(8)}${String(data.length).padEnd(10)}\`\n`;
    parts.push(Buffer.from(h), data); if (data.length % 2) parts.push(Buffer.from('\n'));
  }
  return Buffer.concat(parts);
}

const binData = fs.readFileSync(bin), iconData = fs.readFileSync(icon);
const desktop = (exec) => `[Desktop Entry]
Type=Application
Name=Draw
GenericName=Editor vetorial
Comment=Editor vetorial com as ferramentas e os atalhos do CorelDRAW
Exec=${exec} %F
Icon=draw
Terminal=false
Categories=Graphics;VectorGraphics;
Keywords=vetor;desenho;svg;pdf;design;carrossel;
StartupWMClass=Draw
`;

// ---------- .deb ----------
const dataEntries = [
  { name: './', dir: true }, { name: './opt/', dir: true }, { name: './opt/draw/', dir: true },
  { name: './opt/draw/draw', data: binData, mode: 0o755 }, { name: './opt/draw/draw.png', data: iconData },
  { name: './usr/', dir: true }, { name: './usr/bin/', dir: true }, { name: './usr/bin/draw', link: '/opt/draw/draw' },
  { name: './usr/share/', dir: true }, { name: './usr/share/applications/', dir: true }, { name: './usr/share/applications/draw.desktop', data: desktop('/opt/draw/draw') },
  { name: './usr/share/icons/', dir: true }, { name: './usr/share/icons/hicolor/', dir: true }, { name: './usr/share/icons/hicolor/512x512/', dir: true }, { name: './usr/share/icons/hicolor/512x512/apps/', dir: true },
  { name: './usr/share/icons/hicolor/512x512/apps/draw.png', data: iconData },
];
const kb = Math.ceil((binData.length + iconData.length * 2 + 2048) / 1024);
const control = `Package: draw-editor
Version: ${version}
Section: graphics
Priority: optional
Architecture: amd64
Depends: libgtk-3-0, libwebkit2gtk-4.1-0 | libwebkit2gtk-4.0-37
Installed-Size: ${kb}
Maintainer: Draw <https://draw.mais.live>
Homepage: https://draw.mais.live
Description: Editor vetorial com o fluxo de trabalho do CorelDRAW
 Desenhe e edite curvas, use PowerClip, preenchimento gradiente com nós,
 mais de 2 mil fontes e modos para redes sociais (Carrossel, Feed + Story).
 Exporta PDF, SVG, EPS e PNG.
`;
const refresh = `command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q /usr/share/applications || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
`;
const controlTar = tar([{ name: './', dir: true }, { name: './control', data: control }, { name: './postinst', data: '#!/bin/sh\n' + refresh + 'exit 0\n', mode: 0o755 }, { name: './postrm', data: '#!/bin/sh\n' + refresh + 'exit 0\n', mode: 0o755 }]);
const deb = ar([['debian-binary', Buffer.from('2.0\n')], ['control.tar.gz', controlTar], ['data.tar.gz', tar(dataEntries)]]);
fs.writeFileSync(path.join(outDir, `draw_${version}_amd64.deb`), deb);

// ---------- .tar.gz com install.sh (qualquer distribuição) ----------
const install = `#!/bin/sh
# Instala o Draw só para o usuário atual (sem sudo): ~/.local/share/draw
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.local/share/draw"
mkdir -p "$DEST" "$HOME/.local/bin" "$HOME/.local/share/applications" "$HOME/.local/share/icons/hicolor/512x512/apps"
cp "$DIR/draw" "$DEST/draw" && chmod 755 "$DEST/draw"
cp "$DIR/draw.png" "$DEST/draw.png"
cp "$DIR/draw.png" "$HOME/.local/share/icons/hicolor/512x512/apps/draw.png"
ln -sf "$DEST/draw" "$HOME/.local/bin/draw"
cat > "$HOME/.local/share/applications/draw.desktop" <<EOF
${desktop('"$DEST/draw"').trim()}
EOF
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q "$HOME/.local/share/applications" || true
echo "Draw instalado. Abra pelo menu de aplicativos ou rode: draw"
if ! (ldconfig -p 2>/dev/null | grep -qE 'libwebkit2gtk-4\\.(0|1)'); then
  echo
  echo "Atenção: falta a biblioteca WebKitGTK. Instale com um destes comandos:"
  echo "  Ubuntu/Debian/Mint: sudo apt install libwebkit2gtk-4.1-0"
  echo "  Fedora:             sudo dnf install webkit2gtk4.1"
  echo "  Arch/Manjaro:       sudo pacman -S webkit2gtk-4.1"
  echo "  openSUSE:           sudo zypper install libwebkit2gtk-4_1-0"
fi
`;
const uninstall = `#!/bin/sh
# Remove o Draw instalado pelo install.sh (os projetos salvos não são apagados)
rm -f "$HOME/.local/bin/draw" "$HOME/.local/share/applications/draw.desktop" "$HOME/.local/share/icons/hicolor/512x512/apps/draw.png"
rm -rf "$HOME/.local/share/draw"
echo "Draw removido."
`;
const readme = `Draw para Linux (64 bits)

Instalar:    ./install.sh
Remover:     ./uninstall.sh

Precisa da biblioteca WebKitGTK 4.1 (ou 4.0). Se o Draw não abrir, instale:
  Ubuntu/Debian/Mint: sudo apt install libwebkit2gtk-4.1-0
  Fedora:             sudo dnf install webkit2gtk4.1
  Arch/Manjaro:       sudo pacman -S webkit2gtk-4.1

Em Ubuntu, Debian e Mint prefira o pacote draw_${version}_amd64.deb (instala as dependências sozinho).
`;
fs.writeFileSync(path.join(outDir, `draw-${version}-linux-x64.tar.gz`), tar([
  { name: 'draw-linux-x64/', dir: true }, { name: 'draw-linux-x64/draw', data: binData, mode: 0o755 }, { name: 'draw-linux-x64/draw.png', data: iconData },
  { name: 'draw-linux-x64/install.sh', data: install, mode: 0o755 }, { name: 'draw-linux-x64/uninstall.sh', data: uninstall, mode: 0o755 }, { name: 'draw-linux-x64/LEIA-ME.txt', data: readme },
]));
console.log('ok', fs.readdirSync(outDir).filter(f => /\.(deb|tar\.gz)$/.test(f)).map(f => `${f} ${fs.statSync(path.join(outDir, f)).size}`).join(' | '));
