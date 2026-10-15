const fs = require('fs'), path = require('path');
const pngToIco = require('png-to-ico'); const rcedit = require('rcedit');
(async () => {
  const [exe, png, ico] = process.argv.slice(2);
  fs.writeFileSync(ico, await (pngToIco.default || pngToIco)(png));
  await (rcedit.rcedit || rcedit)(exe, { icon: ico, 'file-version': '1.0.0', 'product-version': '1.0.0',
    'version-string': { ProductName: 'Draw', FileDescription: 'Draw — editor vetorial', CompanyName: 'Draw', LegalCopyright: 'Código aberto', OriginalFilename: 'Draw-Windows.exe', InternalName: 'Draw' } });
  console.log('icon ok', fs.statSync(exe).size);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
