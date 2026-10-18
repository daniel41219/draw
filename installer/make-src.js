// Recupera o arquivo-fonte do editor (src/draw.html) a partir de resources/index.html do programa.
// O fonte usa as bibliotecas pela CDN; build-desktop.ps1 troca por cópias locais e build-site.ps1 usa como está.
// Uso: node make-src.js <resources/index.html> <src/draw.html>
const fs = require('fs'), path = require('path');
const [from, to] = process.argv.slice(2);
const s = fs.readFileSync(from, 'utf8').replace(/\r\n/g, '\n');
const h0 = s.indexOf('<title>'), h1 = s.indexOf('</head>'), b0 = s.indexOf('<body>') + 6, b1 = s.lastIndexOf('</body>');
if (h0 < 0 || h1 < 0 || b0 < 6 || b1 < 0) throw new Error('estrutura inesperada em ' + from);
let src = s.slice(h0, h1).trim() + '\n' + s.slice(b0, b1).trim() + '\n';
const CDN = {
  'lib/paper-core.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/paper.js/0.12.17/paper-core.min.js',
  'lib/jspdf.umd.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'lib/svg2pdf.umd.min.js': 'https://cdn.jsdelivr.net/npm/svg2pdf.js@2.2.3/dist/svg2pdf.umd.min.js',
  'lib/opentype.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/opentype.js/1.3.4/opentype.min.js',
};
for (const [k, v] of Object.entries(CDN)) src = src.split(k).join(v);
fs.mkdirSync(path.dirname(to), { recursive: true });
fs.writeFileSync(to, src);
console.log('fonte:', to, src.length, 'bytes');
