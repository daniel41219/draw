/* Importador de arquivos do CorelDRAW (.cdr / .cdrt) para o Draw.
   Lê o formato RIFF do CorelDRAW (versões 7 a 2024, com melhor suporte a X6 em diante, que é um ZIP
   com content/root.dat + content/data/*.dat) e converte para os objetos do Draw: retângulos, elipses,
   curvas, polígonos, textos artísticos e de parágrafo, bitmaps e grupos, com preenchimento (sólido e
   degradê), contorno e transparência uniforme. O que não der para ler vira a pré-visualização da página
   que o próprio CorelDRAW grava dentro do arquivo.
   Uso: DrawCDR.parse(arrayBuffer, { nextId }) → Promise<{ pages, assets, warnings, nextId }> */
(function (root) {
  'use strict';

  /* ---------- utilidades binárias ---------- */
  const td8 = new TextDecoder('utf-8'), td16 = new TextDecoder('utf-16le');
  const fourcc = (u8, o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  const dv = u8 => new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const u16 = (u8, o) => u8[o] | (u8[o + 1] << 8);
  const u32 = (u8, o) => (u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24)) >>> 0;
  const s32 = (u8, o) => u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24);
  const s16 = (u8, o) => { const v = u16(u8, o); return v > 32767 ? v - 65536 : v; };
  const f64 = (u8, o) => dv(u8).getFloat64(o, true);
  const r4 = v => Math.round(v * 10000) / 10000;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  async function streamBytes(u8, ctor, fmt) {
    const s = new Blob([u8]).stream().pipeThrough(new ctor(fmt));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  const inflateRaw = u8 => streamBytes(u8, DecompressionStream, 'deflate-raw');
  const inflateZlib = u8 => streamBytes(u8, DecompressionStream, 'deflate');
  const deflateZlib = u8 => streamBytes(u8, CompressionStream, 'deflate');

  /* ---------- ZIP (CorelDRAW X4 em diante) ---------- */
  function readZip(u8) {
    let e = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (u32(u8, i) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('zip');
    const n = u16(u8, e + 10), entries = new Map();
    let p = u32(u8, e + 16);
    for (let i = 0; i < n && u32(u8, p) === 0x02014b50; i++) {
      const method = u16(u8, p + 10), csize = u32(u8, p + 20), nl = u16(u8, p + 28), xl = u16(u8, p + 30), cl = u16(u8, p + 32), lho = u32(u8, p + 42);
      const name = td8.decode(u8.subarray(p + 46, p + 46 + nl));
      entries.set(name.replace(/\\/g, '/'), { method, csize, lho });
      p += 46 + nl + xl + cl;
    }
    const cache = new Map();
    return {
      has: name => entries.has(name),
      names: () => [...entries.keys()],
      async get(name) {
        const z = entries.get(name); if (!z) return null;
        if (cache.has(name)) return cache.get(name);
        const d0 = z.lho + 30 + u16(u8, z.lho + 26) + u16(u8, z.lho + 28), raw = u8.subarray(d0, d0 + z.csize);
        const out = z.method === 0 ? raw : await inflateRaw(raw);
        cache.set(name, out); return out;
      },
    };
  }

  /* ---------- árvore RIFF ---------- */
  // Nó: { id, list (tipo do LIST), kids, data }. Na X6+, um chunk de 16 bytes aponta para outro arquivo de dados.
  function parseRiff(u8, ctx, off = 0, end = u8.length, out = []) {
    while (off + 8 <= end) {
      const id = fourcc(u8, off); let len = u32(u8, off + 4);
      if (ctx.blockSizes) len = ctx.blockSizes[len] ?? 0;
      if (len > end - off - 8) len = end - off - 8;
      if (id === 'LIST' || id === 'RIFF') {
        const list = fourcc(u8, off + 8), node = { id, list, kids: [], pos: off };
        if (list === 'cmpr') { node.cmpr = u8.subarray(off + 12, off + 8 + len); out.push(node); }
        else { parseRiff(u8, ctx, off + 12, off + 8 + len, node.kids); out.push(node); }
      } else {
        let data = u8.subarray(off + 8, off + 8 + len);
        if (ctx.streams && len === 16) {
          const s = u32(data, 0), l = u32(data, 4);
          if (s === 0xffffffff) data = data.subarray(8, 8 + Math.min(l, 8));
          else if (ctx.streams[s]) { const o = u32(data, 8); data = ctx.streams[s].subarray(o, o + l); }
        }
        out.push({ id, data });
      }
      off += 8 + len + (len & 1);
    }
    return out;
  }
  // Blocos 'cmpr' (CorelDRAW 8 a X3): zlib com tabela de tamanhos dos chunks
  async function expandCmpr(nodes, ctx) {
    for (const n of nodes) {
      if (n.cmpr) {
        const c = n.cmpr, csize = u32(c, 0), bsize = u32(c, 8);
        const data = await inflateZlib(c.subarray(20, 20 + csize));
        const bs = await inflateZlib(c.subarray(20 + csize, 20 + csize + bsize));
        const sizes = []; for (let i = 0; i + 4 <= bs.length; i += 4) sizes.push(u32(bs, i));
        n.kids = parseRiff(data, Object.assign({}, ctx, { blockSizes: sizes }));
        n.list = 'cmpd'; delete n.cmpr;
      }
      if (n.kids) await expandCmpr(n.kids, ctx);
    }
  }
  const kid = (n, id, list) => n.kids && n.kids.find(k => k.id === id && (!list || k.list === list));
  const kidsOf = (n, id, list) => (n.kids || []).filter(k => k.id === id && (!list || k.list === list));
  function* all(n, id, list) { for (const k of n.kids || []) { if (k.id === id && (!list || k.list === list)) yield k; if (k.kids) yield* all(k, id, list); } }
  // o conteúdo de um 'cmpd' se comporta como se estivesse no lugar do LIST cmpr
  function flatten(nodes) { const out = []; for (const n of nodes) { if (n.list === 'cmpd') out.push(...flatten(n.kids)); else { if (n.kids) n.kids = flatten(n.kids); out.push(n); } } return out; }

  /* ---------- cores ---------- */
  const hex2 = v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  const rgbHex = (r, g, b) => '#' + hex2(r) + hex2(g) + hex2(b);
  // CMYK → RGB aproximado (parecido com o perfil padrão do CorelDRAW, um pouco menos saturado que a fórmula ingênua)
  function cmyk2rgb(c, m, y, k) {
    // cada tinta absorve parte de cada canal (cores puras próximas das tintas de processo: C 0,174,239; M 236,0,140; Y 255,242,0; K 35,31,32)
    const C = clamp(c, 0, 1), M = clamp(m, 0, 1), Y = clamp(y, 0, 1), K = clamp(k, 0, 1);
    const ch = (a, b, d, e) => Math.max(26, 255 * (1 - C * a) * (1 - M * b) * (1 - Y * d) * (1 - K * e)); // preto composto não passa de ~#1a1a1a no papel
    return rgbHex(ch(1, 0.075, 0, 0.863), ch(0.318, 1, 0.051, 0.878), ch(0.063, 0.451, 1, 0.875));
  }
  function hsb2rgb(h, s, v) { const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }; return rgbHex(f(5) * 255, f(3) * 255, f(1) * 255); }
  function hls2rgb(h, l, s) { const a = s * Math.min(l, 1 - l), f = n => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; return rgbHex(f(0) * 255, f(8) * 255, f(4) * 255); }
  // modelo + 4 bytes de valor, como gravado no binário
  function colorFromModel(model, v) {
    const b0 = v & 255, b1 = (v >>> 8) & 255, b2 = (v >>> 16) & 255, b3 = v >>> 24;
    switch (model) {
      case 2: case 4: return cmyk2rgb(b0 / 100, b1 / 100, b2 / 100, model === 4 ? 0 : b3 / 100);
      case 3: case 0x11: return cmyk2rgb(b0 / 255, b1 / 255, b2 / 255, b3 / 255);
      case 5: return rgbHex(b2, b1, b0);
      case 6: return hsb2rgb(u16le(v), b2 / 255, b3 / 255);
      case 7: return hls2rgb(u16le(v), b2 / 255, b3 / 255);
      case 9: return rgbHex(b0, b0, b0);
      case 0x14: return '#000000'; // registro
      case 1: case 0x19: case 0x1e: case 0x18: case 0x1a: return null; // Pantone/ cor especial: sem tabela, quem chama decide
      default: return null;
    }
  }
  const u16le = v => v & 0xffff;
  // "RGB255,USER,212,183,232,100,uuid" / "CMYK,USER,0,0,0,100,100,uuid" (texto JSON da X6+)
  function colorFromString(s) {
    if (!s || typeof s !== 'string') return null;
    const p = s.split(','), m = p[0].toUpperCase(), n = p.slice(2).map(Number);
    if (m.startsWith('RGB')) return rgbHex(n[0], n[1], n[2]);
    if (m === 'CMYK255' || (m.startsWith('CMYK') && Math.max(n[0], n[1], n[2], n[3]) > 100)) return cmyk2rgb(n[0] / 255, n[1] / 255, n[2] / 255, n[3] / 255);
    if (m.startsWith('CMYK')) return cmyk2rgb(n[0] / 100, n[1] / 100, n[2] / 100, n[3] / 100);
    if (m.startsWith('CMY')) return cmyk2rgb(n[0] / 255, n[1] / 255, n[2] / 255, 0);
    if (m.startsWith('GRAY') || m.startsWith('GREY')) return rgbHex(n[0], n[0], n[0]);
    if (m.startsWith('HSB') || m.startsWith('HSV')) return hsb2rgb(n[0], n[1] / 255, n[2] / 255);
    if (m.startsWith('HLS')) return hls2rgb(n[0], n[1] / 255, n[2] / 255);
    if (m.startsWith('LAB')) { // Lab → sRGB
      const L = n[0], A = n[1] - 128, B = n[2] - 128, fy = (L + 16) / 116, fx = fy + A / 500, fz = fy - B / 200;
      const g = t => t > 0.206897 ? t * t * t : (t - 16 / 116) / 7.787, X = 0.9505 * g(fx), Y = g(fy), Z = 1.089 * g(fz);
      const c = v => 255 * (v > 0.0031308 ? 1.055 * Math.pow(v, 1 / 2.4) - 0.055 : 12.92 * v);
      return rgbHex(c(3.2406 * X - 1.5372 * Y - 0.4986 * Z), c(-0.9689 * X + 1.8758 * Y + 0.0415 * Z), c(0.0557 * X - 0.204 * Y + 1.057 * Z));
    }
    return null;
  }

  /* ---------- texto: codificação ---------- */
  // O CorelDRAW grava o texto em UTF-8, em UTF-16 ou numa página de código de 1 byte (cp1252 no português),
  // conforme a versão e a fonte. Decide pelo tamanho (bytes × caracteres) e pela validade do UTF-8.
  const CHARSETS = { 0: 'windows-1252', 1: 'windows-1252', 238: 'windows-1250', 204: 'windows-1251', 161: 'windows-1253', 162: 'windows-1254', 177: 'windows-1255', 178: 'windows-1256', 186: 'windows-1257', 163: 'windows-1258', 222: 'windows-874', 128: 'shift_jis', 129: 'euc-kr', 134: 'gbk', 136: 'big5' };
  const decoders = {};
  function dec(enc, bytes, fatal) {
    const k = enc + (fatal ? '!' : '');
    try { if (!decoders[k]) decoders[k] = new TextDecoder(enc, { fatal: !!fatal }); return decoders[k].decode(bytes); } catch { return null; }
  }
  function decodeText(bytes, nc, charset) {
    if (!bytes.length) return '';
    let ascii = true; for (const b of bytes) if (b > 127) { ascii = false; break; }
    if (ascii) return td8.decode(bytes);
    const cp = CHARSETS[+charset] || 'windows-1252';
    if (nc && bytes.length === 2 * nc) { // UTF-16: metade dos bytes altos costuma ser zero
      let z = 0; for (let i = 1; i < bytes.length; i += 2) if (!bytes[i]) z++;
      if (z >= nc / 2) return dec('utf-16le', bytes) || td16.decode(bytes);
    }
    if (nc && bytes.length === nc) return dec(cp, bytes) || dec('windows-1252', bytes);
    return dec('utf-8', bytes, true) ?? dec(cp, bytes) ?? td8.decode(bytes);
  }

  /* ---------- leitor ---------- */
  class Reader {
    constructor(ver) {
      this.ver = ver; this.fills = new Map(); this.outls = new Map(); this.bmps = new Map(); this.texts = new Map(); this.fonts = new Map();
      this.warn = new Set(); this.unknown = new Map(); this.clips = new Map(); this.clipDepth = 0;
    }
    coord(u8, o) { return this.ver < 600 ? s16(u8, o) / 1000 * 25.4 : s32(u8, o) / 10000; } // em mm
    get csz() { return this.ver < 600 ? 2 : 4; }
    angle(u8, o) { return this.ver < 1300 ? s32(u8, o) / 10 : s32(u8, o) / 1e6; } // graus
    color(u8, o) { // u16 modelo, depois o valor
      const model = u16(u8, o), v = u32(u8, o + (this.ver >= 1300 ? 8 : this.ver >= 600 ? 4 : 2));
      return { model, c: colorFromModel(model, v) };
    }

    /* preenchimentos ('fild') */
    readFild(d) {
      const id = u32(d, 0), V = this.ver;
      try {
        const tp = V >= 1300 ? 12 : 4, type = u16(d, tp);
        if (type === 0) { this.fills.set(id, null); return; }
        if (type === 1) {
          const c = this.color(d, V >= 1300 ? tp + 15 : tp + 4).c;
          this.fills.set(id, c || '#808080'); return;
        }
        if (type === 2) {
          let p = V >= 1300 ? tp + 10 : tp + 2;
          const gt = d[p]; // 1 linear, 2 radial, 3 cônico, 4 quadrado
          let edge = 0;
          if (V >= 1300) { p += 18; edge = s16(d, p); p += 2; } else { p += V >= 600 ? 2 : 1; edge = s16(d, p); p += 2; }
          const ang = this.angle(d, p); p += 4;
          const cx = s32(d, p), cy = s32(d, p + 4); p += 8;
          if (V >= 600) p += 2;
          p += 4; const mid = d[p]; p += 2;
          const ns = V >= 1300 ? u16(d, p) : d[p]; p += V >= 1300 ? 2 : 3;
          const stops = [];
          for (let i = 0; i < ns && i < 64; i++) {
            if (V >= 1300) {
              const c = this.color(d, p + 5).c; // 5 bytes de cabeçalho, 12 da cor, 5 + 16 (paleta), 7 com a posição
              const pos = d[p + 5 + 12 + 21 + 5];
              stops.push({ o: clamp(pos / 100, 0, 1), c: c || '#808080' }); p += 45;
            } else {
              const c = this.color(d, p).c; p += V >= 600 ? 8 : 6;
              const pos = u32(d, p) & 0xff; p += 4;
              stops.push({ o: clamp(pos / 100, 0, 1), c: c || '#808080' });
            }
          }
          if (stops.length < 2) { this.fills.set(id, stops[0] ? stops[0].c : null); return; }
          this.fills.set(id, { cdrGrad: true, gt, ang, cx, cy, edge, mid, stops }); return;
        }
        // textura, padrão, PostScript, malha: cor média aproximada
        this.warn.add('Alguns preenchimentos especiais (padrão, textura ou malha) viraram cinza.');
        this.fills.set(id, '#b2b2b2');
      } catch { this.fills.set(id, '#b2b2b2'); }
    }

    /* contornos ('outl') */
    readOutl(d) {
      const id = u32(d, 0), V = this.ver;
      try {
        let p = 4, color = null;
        if (V >= 1300) { // blocos marcados: 1 = linha, 2 = cor
          let line = -1;
          while (p + 8 <= d.length) {
            const t = u32(d, p), l = u32(d, p + 4);
            if (t === 1) { line = p + 8; }
            if (t === 2) color = this.color(d, p + 8 + 5).c;
            p += 8 + l; if (t === 1) break;
          }
          if (line < 0) { this.outls.set(id, null); return; }
          p = line;
          const type = u16(d, p), caps = u16(d, p + 2), join = u16(d, p + 4), w = this.coord(d, p + 6);
          if (color == null) color = this.color(d, p + 64).c;
          this.outls.set(id, { type, caps, join, w, color: color || '#000000' });
        } else {
          const type = u16(d, p), caps = u16(d, p + 2), join = u16(d, p + 4); p += 6; if (V >= 600) p += 2;
          const w = this.coord(d, p); p += this.csz;
          // cor: depois de estica (2), ângulo (4) e reservado; posição varia pela versão
          const cp = p + (V >= 600 ? (V >= 1000 ? 54 : 46) : 10);
          const c = cp + 12 <= d.length ? this.color(d, cp).c : null;
          this.outls.set(id, { type, caps, join, w, color: c || '#000000' });
        }
      } catch { this.outls.set(id, null); }
    }

    /* bitmaps ('bmp ') */
    readBmp(d) {
      try {
        const id = u32(d, 0), V = this.ver;
        let p = 4 + (V < 600 ? 14 : V < 700 ? 46 : 50);
        // modelo, ?, largura, altura, ?, bits por pixel, bytes por linha, tamanho, 32 reservados
        const model = u32(d, p), w = u32(d, p + 8), h = u32(d, p + 12), bpp = u32(d, p + 20), size = u32(d, p + 28);
        p += 64;
        let pal = null;
        if (bpp < 24 && model !== 5 && model !== 6) {
          p += 2; const nc = u16(d, p); p += 2; pal = [];
          for (let i = 0; i < nc; i++) { pal.push([d[p + 2], d[p + 1], d[p]]); p += 3; }
        }
        if (!(w > 0 && h > 0 && w * h < 80e6)) return;
        const bits = d.subarray(p, p + size), rest = d.subarray(p + size);
        this.bmps.set(id, { model, w, h, bpp, pal, bits, rest });
      } catch { }
    }

    /* textos ('txsm'), X6 em diante: estilos em JSON */
    readTxsm16(d) {
      try {
        const id = u32(d, 45), m = [0, 1, 2, 3, 4, 5].map(i => f64(d, 49 + 8 * i));
        // blocos JSON: u32 tamanho seguido de "{"
        const js = [];
        for (let p = 97; p + 6 < d.length; p++) {
          if (d[p + 4] === 0x7b && (d[p + 5] === 0x0a || d[p + 5] === 0x22 || d[p + 5] === 0x7d)) {
            const L = u32(d, p);
            if (L > 1 && p + 4 + L <= d.length && d[p + 3 + L] === 0x7d) { js.push({ p, L }); p += 3 + L; }
          }
        }
        const J = k => { try { return JSON.parse(td8.decode(d.subarray(js[k].p + 4, js[k].p + 4 + js[k].L))); } catch { return {}; } };
        let frame = null, k = 0;
        if (js.length && 'frame' in J(0) && !('character' in J(0))) { frame = J(0).frame; k = 1; }
        const paras = [];
        while (k < js.length) {
          const base = J(k), endBase = js[k].p + 4 + js[k].L;
          if (!base.character && !base.paragraph) { k++; continue; }
          // registros de estilo de trecho
          let p = endBase; const ns = u32(d, p); p += 4; const recs = [];
          for (let i = 0; i < ns && i < 512; i++) {
            const fl = u16(d, p + 4); p += 6;
            if (fl & 4) { const n = u32(d, p); p += 4 + 2 * n; }
            const L = u32(d, p), s = td8.decode(d.subarray(p + 4, p + 4 + L)); p += 4 + L;
            let o = {}; try { o = JSON.parse(s); } catch { }
            recs.push(o);
            while (k + 1 < js.length && js[k + 1].p < p) k++;
          }
          const nc = u32(d, p); p += 4;
          const runs = []; for (let i = 0; i < nc && i < 100000; i++) runs.push(u16(d, p + 8 * i + 2) >> 1); // 8 bytes por caractere; o estilo (×2) fica no 3º byte
          p += 8 * nc;
          const bl = u32(d, p); p += 4;
          const text = decodeText(d.subarray(p, p + bl), nc, (base.character && base.character.latin && base.character.latin.charset) || 0); p += bl;
          paras.push({ base, recs, runs, text });
          k++;
          while (k < js.length && js[k].p < p) k++;
        }
        const T = { m, frame, paras, artistic: u32(d, 0) !== 0 };
        this.texts.set(id, T); return T;
      } catch { return null; }
    }
    // versões antigas: só o texto puro (estilo do objeto)
    readTxsmOld(d) {
      try {
        // procura uma sequência longa de UTF-16 imprimível
        let best = '', id = u32(d, 0);
        for (let p = 0; p + 4 < d.length; p++) {
          const n = u32(d, p); if (n < 1 || n > 20000 || p + 4 + 2 * n > d.length) continue;
          const s = td16.decode(d.subarray(p + 4, p + 4 + 2 * n));
          if (/^[\x09\x0a\x0d\x20-\x7e\u00a0-\u024f\u2000-\u206f]+$/.test(s) && s.length > best.length) best = s;
        }
        if (best) { const T = { m: null, paras: [{ base: {}, recs: [], runs: [], text: best }], artistic: true }; this.texts.set(id, T); return T; }
      } catch { }
      return null;
    }
    readFont(d) {
      try {
        const id = u16(d, 0), V = this.ver;
        const off = V >= 1200 ? 18 : 4, name = V >= 1200 ? td16.decode(d.subarray(off, off + 64)) : td8.decode(d.subarray(off, off + 32));
        this.fonts.set(id, name.replace(/\0[\s\S]*$/, ''));
      } catch { }
    }

    /* transformação ('trfd'): lista de matrizes [a b tx; c d ty] */
    readTrfd(d) {
      const V = this.ver; let M = [1, 0, 0, 0, 1, 0];
      try {
        const n = u32(d, 4), sa = u32(d, 8);
        for (let i = 0; i < n && i < 16; i++) {
          let p = u32(d, sa + 4 * i); if (V >= 1300) p += 8;
          const t = u16(d, p);
          if (t !== 8) continue;
          p += V >= 600 ? 8 : 2;
          const k = V >= 600 ? 10000 : 1000 / 25.4;
          const m = [f64(d, p), f64(d, p + 8), f64(d, p + 16) / k, f64(d, p + 24), f64(d, p + 32), f64(d, p + 40) / k];
          M = mul(m, M);
        }
      } catch { }
      return M;
    }
  }
  // composição: aplica B e depois A (A·B)
  const mul = (A, B) => [A[0] * B[0] + A[1] * B[3], A[0] * B[1] + A[1] * B[4], A[0] * B[2] + A[1] * B[5] + A[2], A[3] * B[0] + A[4] * B[3], A[3] * B[1] + A[4] * B[4], A[3] * B[2] + A[4] * B[5] + A[5]];
  const ap = (M, x, y) => ({ x: M[0] * x + M[1] * y + M[2], y: M[3] * x + M[4] * y + M[5] });

  /* ---------- geometria → nós do Draw ---------- */
  // pontos CDR: tipo 0x00 move, 0x40 reta, 0x80 fim de curva, 0xC0 controle; bit 0x08 fecha
  function pathFromPoints(pts, types) {
    const subs = []; let cur = null, ctrl = [];
    const closeCur = () => {
      if (!cur || !cur.nodes.length) return;
      const N = cur.nodes, a = N[0], b = N[N.length - 1];
      if (N.length > 1 && Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6) { a.ix = b.ix; a.iy = b.iy; N.pop(); }
      cur.closed = true;
    };
    for (let i = 0; i < pts.length; i++) {
      const t = types[i], p = pts[i], close = !!(t & 8), k = t & 0xc0;
      if (k === 0x00) { if (cur && cur.nodes.length) subs.push(cur); cur = { nodes: [N(p)], closed: false }; ctrl = []; continue; }
      if (!cur) cur = { nodes: [N(p)], closed: false };
      if (k === 0xc0) { ctrl.push(p); continue; }
      const last = cur.nodes[cur.nodes.length - 1];
      if (k === 0x80 && ctrl.length >= 2) { last.ox = ctrl[0].x; last.oy = ctrl[0].y; const n = N(p); n.ix = ctrl[1].x; n.iy = ctrl[1].y; cur.nodes.push(n); }
      else cur.nodes.push(N(p));
      ctrl = [];
      if (close) { closeCur(); subs.push(cur); cur = null; }
    }
    if (cur && cur.nodes.length) subs.push(cur);
    return subs.filter(s => s.nodes.length > 1 || s.closed);
  }
  const N = p => ({ x: p.x, y: p.y, ix: p.x, iy: p.y, ox: p.x, oy: p.y, s: false });
  const KAPPA = 0.5522847498;
  function ellipseSubs(cx, cy, rx, ry, a1, a2, pie) {
    // arco de a1 a a2 (graus, anti-horário no sistema do Corel) em segmentos de até 90°
    const full = Math.abs(a1 - a2) < 1e-9;
    if (full) { a1 = 0; a2 = 360; }
    while (a2 <= a1) a2 += 360;
    const segs = Math.max(1, Math.ceil((a2 - a1) / 90 - 1e-9)), st = (a2 - a1) / segs * Math.PI / 180;
    const pt = a => ({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
    const nodes = []; let a = a1 * Math.PI / 180;
    const k = 4 / 3 * Math.tan(st / 4);
    nodes.push(N(pt(a)));
    for (let i = 0; i < segs; i++) {
      const b = a + st, p0 = nodes[nodes.length - 1];
      p0.ox = cx + rx * (Math.cos(a) - k * Math.sin(a)); p0.oy = cy + ry * (Math.sin(a) + k * Math.cos(a));
      const n = N(pt(b)); n.ix = cx + rx * (Math.cos(b) + k * Math.sin(b)); n.iy = cy + ry * (Math.sin(b) - k * Math.cos(b));
      nodes.push(n); a = b;
    }
    if (full) { const f = nodes[0], l = nodes.pop(); f.ix = l.ix; f.iy = l.iy; return [{ nodes, closed: true }]; }
    if (pie) { nodes.push(N({ x: cx, y: cy })); return [{ nodes, closed: true }]; }
    return [{ nodes, closed: false }];
  }
  function rectSubs(w, h, r) {
    const x0 = Math.min(0, w), y0 = Math.min(0, h), W = Math.abs(w), H = Math.abs(h);
    r = Math.min(r || 0, W / 2, H / 2);
    const P = (x, y) => N({ x, y });
    if (!(r > 0)) return [{ nodes: [P(x0, y0), P(x0 + W, y0), P(x0 + W, y0 + H), P(x0, y0 + H)], closed: true }];
    const k = r * KAPPA, n6 = (x, y, ix, iy, ox, oy) => ({ x, y, ix, iy, ox, oy, s: false });
    return [{ closed: true, nodes: [n6(x0 + r, y0, x0 + r - k, y0, x0 + r, y0), n6(x0 + W - r, y0, x0 + W - r, y0, x0 + W - r + k, y0),
      n6(x0 + W, y0 + r, x0 + W, y0 + r - k, x0 + W, y0 + r), n6(x0 + W, y0 + H - r, x0 + W, y0 + H - r, x0 + W, y0 + H - r + k),
      n6(x0 + W - r, y0 + H, x0 + W - r + k, y0 + H, x0 + W - r, y0 + H), n6(x0 + r, y0 + H, x0 + r, y0 + H, x0 + r - k, y0 + H),
      n6(x0, y0 + H - r, x0, y0 + H - r + k, x0, y0 + H - r), n6(x0, y0 + r, x0, y0 + r, x0, y0 + r - k)] }];
  }
  function mapSubs(subs, f) {
    return subs.map(s => ({ closed: s.closed, nodes: s.nodes.map(n => { const a = f(n.x, n.y), i = f(n.ix, n.iy), o = f(n.ox, n.oy); return { x: r4(a.x), y: r4(a.y), ix: r4(i.x), iy: r4(i.y), ox: r4(o.x), oy: r4(o.y), s: !!n.s }; }) }));
  }
  function subsBox(subs) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of subs) for (const n of s.nodes) for (const [x, y] of [[n.x, n.y], [n.ix, n.iy], [n.ox, n.oy]]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /* ---------- PNG (para os bitmaps) ---------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  async function encodePNG(w, h, rgba) {
    const raw = new Uint8Array((w * 4 + 1) * h);
    for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1); }
    const idat = await deflateZlib(raw);
    const chunk = (type, data) => { const c = new Uint8Array(12 + data.length), v = dv(c); v.setUint32(0, data.length); for (let i = 0; i < 4; i++) c[4 + i] = type.charCodeAt(i); c.set(data, 8); v.setUint32(8 + data.length, crc32(c.subarray(4, 8 + data.length))); return c; };
    const ih = new Uint8Array(13), iv = dv(ih); iv.setUint32(0, w); iv.setUint32(4, h); ih[8] = 8; ih[9] = 6;
    const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
    const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    return 'data:image/png;base64,' + b64(out);
  }
  function b64(u8) {
    if (typeof Buffer !== 'undefined') return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64');
    let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s);
  }
  async function bmpToPNG(b) {
    const { w, h, bpp, pal, bits, model } = b, rgba = new Uint8Array(w * h * 4);
    const stride = Math.ceil(w * bpp / 32) * 4;
    for (let y = 0; y < h; y++) {
      const row = bits.subarray((h - 1 - y) * stride, (h - y) * stride); // DIB: de baixo para cima
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4; let r = 0, g = 0, bl = 0, a = 255;
        if (bpp === 32) { if (model === 2 || model === 3) { const c = 255 - row[x * 4], m = 255 - row[x * 4 + 1], yy = 255 - row[x * 4 + 2], k = 255 - row[x * 4 + 3]; r = c * k / 255; g = m * k / 255; bl = yy * k / 255; } else { bl = row[x * 4]; g = row[x * 4 + 1]; r = row[x * 4 + 2]; a = row[x * 4 + 3]; } }
        else if (bpp === 24) { bl = row[x * 3]; g = row[x * 3 + 1]; r = row[x * 3 + 2]; }
        else if (bpp === 8) { const i = row[x]; if (pal && pal[i]) [r, g, bl] = pal[i]; else r = g = bl = i; }
        else if (bpp === 1) { const i = (row[x >> 3] >> (7 - (x & 7))) & 1; if (pal && pal[i]) [r, g, bl] = pal[i]; else r = g = bl = i ? 255 : 0; }
        else if (bpp === 4) { const i = (row[x >> 1] >> (x & 1 ? 0 : 4)) & 15; if (pal && pal[i]) [r, g, bl] = pal[i]; else r = g = bl = i * 17; }
        rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = bl; rgba[o + 3] = a;
      }
    }
    if (bpp === 32 && !(model === 2 || model === 3)) { let any = false; for (let i = 3; i < rgba.length; i += 4) if (rgba[i]) { any = true; break; } if (!any) for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255; }
    applyMask(b, rgba);
    return encodePNG(w, h, rgba);
  }
  // Máscara de transparência de 8 bits gravada depois dos pixels (quando existe)
  function applyMask(b, rgba) {
    // bloco "RI": u32 tamanho, u32 0, u32 tamanho do cabeçalho, u32 modelo, u32 ?, largura, altura, ?, bpp, bytes por linha, tamanho
    const { w, h, rest } = b; if (!rest || rest.length < 78 || rest[0] !== 0x52 || rest[1] !== 0x49) return;
    const hs = u32(rest, 10), mw = u32(rest, 22), mh = u32(rest, 26), bpp = u32(rest, 34), stride = u32(rest, 38);
    if (mw !== w || mh !== h || hs + stride * h > rest.length) return;
    for (let y = 0; y < h; y++) {
      const row = rest.subarray(hs + (h - 1 - y) * stride);
      for (let x = 0; x < w; x++) rgba[(y * w + x) * 4 + 3] = bpp === 1 ? ((row[x >> 3] >> (7 - (x & 7))) & 1 ? 255 : 0) : row[x];
    }
  }

  /* ---------- montagem dos objetos ---------- */
  function fontWeight(name, w) {
    if (/black|heavy|blk|extra ?bold|ultra ?bold|xbd/i.test(name)) return 700;
    if (/bold|\bbd\b|semi ?bold|demi/i.test(name)) return 700;
    if (w >= 600 && w <= 1000) return w;
    if (w >= 4096) return 700; // X6+: 64 = normal, 4096 = negrito
    return 400;
  }
  const cleanFont = n => String(n || 'Arial').replace(/\s+(Regular|Normal|Roman)$/i, '').trim() || 'Arial';

  class Builder {
    constructor(R, nextId) { this.R = R; this.id = nextId; this.assets = {}; this.assetKeys = new Map(); this.counts = {}; }
    obj(type, props, name) {
      const label = { rect: 'Retângulo', ellipse: 'Elipse', path: 'Curva', text: 'Texto artístico', image: 'Bitmap', group: 'Grupo' }[type];
      this.counts[type] = (this.counts[type] || 0) + 1;
      return Object.assign({ id: this.id++, type, name: name || `${label} ${this.counts[type]}`, rot: 0, hidden: false, locked: false,
        fill: null, stroke: null, sw: 0.2, dash: 'solid', join: 'miter', cap: 'butt', behind: false, arrowS: false, arrowE: false, opacity: 1, shadow: null }, props);
    }
    group(children, clip) {
      this.counts.group = (this.counts.group || 0) + 1;
      const g = { id: this.id++, type: 'group', name: clip ? 'PowerClip ' + this.counts.group : 'Grupo ' + this.counts.group, children, rot: 0, opacity: 1, hidden: false, locked: false };
      if (clip) g.clip = true;
      return g;
    }
  }

  // estilo de um objeto a partir do loda (ids binários + JSON do argumento 0xc9)
  function styleOf(R, L, M) {
    const st = { fill: undefined, stroke: undefined, sw: 0, opacity: 1 };
    const fid = L.args.get(0x14), oid = L.args.get(0x0a);
    if (fid) { const f = R.fills.get(u32(fid, 0)); st.fill = f === undefined ? undefined : f; }
    if (oid) { const o = R.outls.get(u32(oid, 0)); st.outl = o; }
    const js = L.json;
    if (js && js.fill && js.fill.type != null) {
      const f = js.fill, t = +f.type;
      if (t === 0) st.fill = null;
      else if (t === 1 && f.primaryColor) st.fill = colorFromString(f.primaryColor) || st.fill;
      else if (t === 2 && st.fill && st.fill.cdrGrad) st.fill = Object.assign({}, st.fill, { json: f });
      else if (t === 2 && f.primaryColor && f.secondaryColor) { // degradê só no JSON: duas cores
        const a = colorFromString(f.primaryColor) || '#000000', b = colorFromString(f.secondaryColor) || '#ffffff', flip = f.flipFountainColor === '1';
        st.fill = { cdrGrad: true, gt: +(f.fountainType || 1) || 1, ang: 0, cx: 0, cy: 0, edge: 0, json: f, stops: [{ o: 0, c: flip ? b : a }, { o: 1, c: flip ? a : b }] };
      }
    }
    if (js && js.outline) {
      const o = Object.assign({}, st.outl || { type: 1, caps: 0, join: 0, w: 0, color: '#000000' }), J = js.outline;
      if (J.width != null) o.w = +J.width / 10000;
      if (J.color) o.color = colorFromString(J.color) || o.color;
      if (J.endCaps != null) o.caps = +J.endCaps;
      if (J.joinType != null) o.join = +J.joinType;
      if (J.behindFill != null) o.behind = J.behindFill === '1';
      if (J.dashDotSpec && J.dashDotSpec !== '0') o.dashed = true;
      if (J.type != null) o.type = +J.type === 0 ? 1 : 2;
      else if (J.width != null && +J.width > 0) o.type = 2;
      st.outl = o;
    }
    if (js && js.transparency && js.transparency.uniformTransparency != null) st.opacity = clamp(1 - +js.transparency.uniformTransparency, 0, 1);
    // transparência em degradê → máscara do Draw (o.transp: a0/a1 = transparência no início/fim)
    const TF = js && js.transparency && js.transparency.fill;
    if (TF && +TF.type === 2) {
      const gray = s => { const p = String(s || '').split(','); return p[0].toUpperCase().startsWith('GRAY') ? +p[2] / 255 : null; };
      let t0 = js.transparency.startTransparency != null ? +js.transparency.startTransparency : 1 - (gray(TF.primaryColor) ?? 1);
      let t1 = js.transparency.endTransparency != null ? +js.transparency.endTransparency : 1 - (gray(TF.secondaryColor) ?? 0);
      const g = gradFill({ cdrGrad: true, gt: +(TF.fountainType || 1) || 1, ang: 0, cx: 0, cy: 0, edge: 0, json: TF, stops: [{ o: 0, c: '#000000' }, { o: 1, c: '#000000' }] }, true);
      if (g.g === 'linear') st.transp = { g: 'linear', x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2, a0: clamp(t0, 0, 1), a1: clamp(t1, 0, 1) };
      else st.transp = { g: 'radial', cx: g.cx ?? g.x1, cy: g.cy ?? g.y1, r: g.r ?? 0.5, a0: clamp(t1, 0, 1), a1: clamp(t0, 0, 1) }; // radial: o centro é o fim
    }
    const o = st.outl;
    if (o && o.w > 0 && !(o.type & 1)) { // bit 1 do tipo = sem contorno
      const sc = Math.sqrt(Math.abs(M[0] * M[4] - M[1] * M[3])) || 1;
      st.stroke = o.color; st.sw = r4(o.scale ? o.w * sc : o.w);
      st.cap = ['butt', 'round', 'square'][o.caps] || 'butt'; st.join = ['miter', 'round', 'bevel'][o.join] || 'miter';
      if (o.behind) st.behind = true;
      if (o.dashed || (o.type & 4)) st.dash = 'dash';
    }
    return st;
  }
  // degradê do Corel → degradê do Draw (coordenadas da caixa do objeto, 0 a 1)
  function gradFill(F, flipY) {
    const J = F.json || {};
    const stops = F.stops.map(s => ({ o: s.o, c: s.c })).sort((a, b) => a.o - b.o);
    const ang = (J.angle != null ? +J.angle : F.ang) * Math.PI / 180;
    const cxo = J.xCenterOffset != null ? +J.xCenterOffset : F.cx, cyo = J.yCenterOffset != null ? +J.yCenterOffset : F.cy;
    const cx = 0.5 + cxo / 100, cy = 0.5 + (flipY ? 1 : -1) * cyo / 100 * -1;
    if (F.gt === 1) {
      const dx = Math.cos(ang), dy = -Math.sin(ang) * (flipY ? -1 : 1);
      let L = 0.5 * (Math.abs(dx) + Math.abs(dy)) * (1 - (F.edge || 0) / 100);
      if (J.xScale != null) L = 0.5 * (Math.abs(dx) + Math.abs(dy)) * +J.xScale;
      const mx = 0.5 + cxo / 100, my = 0.5 - cyo / 100;
      return { g: 'linear', x1: r4(mx - dx * L), y1: r4(my - dy * L), x2: r4(mx + dx * L), y2: r4(my + dy * L), stops };
    }
    // radial, cônico e quadrado: no Corel a 1ª cor fica na borda e a última no centro
    const rs = stops.map(s => ({ o: r4(1 - s.o), c: s.c })).sort((a, b) => a.o - b.o);
    const r = 0.5 * (J.xScale != null ? +J.xScale : (1 - (F.edge || 0) / 100) * 1.4142);
    const ccx = r4(0.5 + cxo / 100), ccy = r4(0.5 - cyo / 100);
    if (F.gt === 3) return { g: 'conic', x1: ccx, y1: ccy, x2: r4(ccx + Math.cos(ang) * 0.5), y2: r4(ccy - Math.sin(ang) * 0.5), stops: F.stops.map(s => ({ o: s.o, c: s.c })) };
    if (F.gt === 4) return { g: 'rect', x1: ccx, y1: ccy, x2: r4(ccx + r), y2: r4(ccy + r), stops: rs };
    return { g: 'radial', cx: ccx, cy: ccy, r: r4(r), stops: rs };
  }

  /* ---------- leitura do loda ---------- */
  function readLoda(R, d) {
    const L = { type: u32(d, 16), args: new Map(), json: null, raw: d };
    try {
      const n = u32(d, 4), sa = u32(d, 8), st = u32(d, 12);
      const offs = [], types = [];
      for (let i = 0; i < n && i < 256; i++) offs.push(u32(d, sa + 4 * i));
      for (let i = 0; i < n && i < 256; i++) types[n - 1 - i] = u32(d, st + 4 * i);
      for (let i = 0; i < offs.length; i++) {
        const end = i + 1 < offs.length ? offs[i + 1] : d.length;
        L.args.set(types[i], d.subarray(offs[i], Math.max(offs[i], end)));
      }
      const js = L.args.get(0xc9);
      if (js && js.length > 8) {
        const cnt = u32(js, 0); let p = 4, o = {};
        for (let k = 0; k < cnt && p + 4 <= js.length; k++) { const l = u32(js, p); try { Object.assign(o, JSON.parse(td8.decode(js.subarray(p + 4, p + 4 + l)).replace(/\0+$/, ''))); } catch { } p += 4 + l; }
        L.json = o;
      }
    } catch { }
    return L;
  }
  function curvePoints(R, a) {
    const n = u32(a, 0), cs = R.csz, pts = [], types = [];
    if (!(n > 0 && n < 1e6) || 4 + n * (2 * cs + 1) > a.length + 1) return null;
    for (let i = 0; i < n; i++) pts.push({ x: R.coord(a, 4 + i * 2 * cs), y: R.coord(a, 4 + i * 2 * cs + cs) });
    for (let i = 0; i < n; i++) types.push(a[4 + n * 2 * cs + i]);
    return { pts, types };
  }

  async function shapeFrom(R, B, L, M, warns) {
    const g = L.args.get(0x1e), t = L.type;
    if (!g && t !== 5) return null;
    let subs = null, local = null;
    if (t === 1) { // retângulo
      let w, h, r = 0;
      if (R.ver >= 1500 && g.length >= 32) { w = f64(g, 0) / 10000; h = f64(g, 8) / 10000; for (let c = 0; c < 4 && 32 + 24 * c + 16 <= g.length; c++) { const v = f64(g, 32 + 24 * c + 8); if (v > 0 && v < 1e9) r = Math.max(r, v / 10000); } }
      else { w = R.coord(g, 0); h = R.coord(g, R.csz); r = Math.abs(R.coord(g, 2 * R.csz)) || 0; }
      local = { kind: 'rect', w, h, r };
      subs = rectSubs(w, h, r);
    } else if (t === 2) { // elipse
      const x = R.coord(g, 0), y = R.coord(g, R.csz), a1 = R.angle(g, 2 * R.csz), a2 = R.angle(g, 2 * R.csz + 4), pie = u32(g, 2 * R.csz + 8) & 1;
      local = { kind: 'ellipse', w: x, h: y, full: Math.abs(a1 - a2) < 1e-9 };
      subs = ellipseSubs(x / 2, y / 2, Math.abs(x / 2), Math.abs(y / 2), a1, a2, pie);
    } else if (t === 3 || t === 0x25) { // curva
      const c = curvePoints(R, g); if (!c) return null;
      subs = pathFromPoints(c.pts, c.types);
    } else if (t === 20) { // polígono / estrela: uma fatia repetida em volta do centro
      const c = curvePoints(R, g), tr = L.args.get(0x2af8); if (!c) return null;
      if (tr && tr.length >= 40) {
        const na = u32(tr, 0), np = u32(tr, 4), rx = f64(tr, 16), ry = f64(tr, 24), cx = R.coord(tr, 32), cy = R.coord(tr, 36);
        const step = 2 * Math.PI / Math.max(1, na), rot = -(np > 1 && na % np ? np : 1) * step;
        const out = [], ty = [];
        for (let i = 0; i < na; i++) {
          const a = rot * i, ca = Math.cos(a), sa = Math.sin(a);
          c.pts.forEach((p, j) => { if (i && j === 0) return; out.push({ x: (p.x * ca - p.y * sa) * rx + cx, y: (p.x * sa + p.y * ca) * ry + cy }); ty.push(j === 0 ? 0 : c.types[j] & 0xf7); });
        }
        ty[ty.length - 1] |= 8;
        subs = pathFromPoints(out, ty);
      } else subs = pathFromPoints(c.pts, c.types);
    } else if (t === 5) { // bitmap
      if (!g) return null;
      const cs = R.csz, xs = [], ys = [];
      for (let i = 0; i < 4; i++) { xs.push(R.coord(g, i * 2 * cs)); ys.push(R.coord(g, i * 2 * cs + cs)); }
      const imgId = u32(g, R.ver >= 600 ? 48 : 32), bm = R.bmps.get(imgId);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      if (!bm) { warns.add('Um bitmap do arquivo não pôde ser lido.'); return null; }
      let aid = B.assetKeys.get(imgId);
      if (!aid) { aid = 'acdr' + Date.now().toString(36) + imgId; try { B.assets[aid] = await bmpToPNG(bm); } catch { warns.add('Um bitmap do arquivo não pôde ser lido.'); return null; } B.assetKeys.set(imgId, aid); }
      return { image: true, aid, corners: [{ x: x0, y: y1 }, { x: x1, y: y1 }, { x: x1, y: y0 }, { x: x0, y: y0 }] };
    } else return null;
    return { subs, local };
  }

  /* ---------- texto ---------- */
  // largura do texto em mm: mede no navegador (canvas); sem canvas, estima pelo número de letras
  let mctx = null;
  function textWidth(s, st, em) {
    try { if (!mctx && typeof document !== 'undefined') mctx = document.createElement('canvas').getContext('2d'); } catch { }
    if (mctx) { mctx.font = `${st.italic ? 'italic ' : ''}${st.weight} 100px '${st.font}', sans-serif`; return mctx.measureText(s).width / 100 * em; }
    return s.length * 0.55 * em;
  }
  function textObjs(R, B, L, M, pageMap, local) {
    const g = L.args.get(0x1e); if (!g) return [];
    const tid = u32(g, g.length >= 12 ? g.length - 4 : 4), T = local || R.texts.get(tid) || R.texts.get(u32(g, 4));
    if (!T) return [];
    const isPara = L.type === 6, LJ = L.json || {};
    // posição e giro vêm da matriz do próprio texto (txsm); a do objeto (trfd) no texto de parágrafo também estica o quadro
    const Mt = T.m && T.m.every(Number.isFinite) && Math.abs(T.m[0] * T.m[4] - T.m[1] * T.m[3]) > 1e-9 ? [T.m[0], T.m[1], T.m[2] / 10000, T.m[3], T.m[4], T.m[5] / 10000] : M;
    const rotDeg = -Math.atan2(Mt[3], Mt[0]) * 180 / Math.PI, rot = Math.abs(rotDeg) > 0.01 ? r4(rotDeg) : 0;
    const scale = Math.sqrt(Math.abs(Mt[0] * Mt[4] - Mt[1] * Mt[3])) || 1;
    // blocos com o mesmo estilo viram um objeto de texto; estilo diferente começa outro logo abaixo
    const blocks = [];
    // cada linha (quebra com Enter vira \r dentro do parágrafo) leva o estilo predominante dos seus caracteres
    const lines = [];
    for (const P of T.paras) {
      const chars = Array.from(P.text); let cur = { P, s: '', cnt: new Map() };
      chars.forEach((c, i) => {
        if (c === '\r' || c === '\n' || c === ' ' || c === ' ' || c === '\u000b') { lines.push(cur); cur = { P, s: '', cnt: new Map() }; return; }
        cur.s += c; const r = P.runs[i] ?? 0; if (c.trim()) cur.cnt.set(r, (cur.cnt.get(r) || 0) + 1);
      });
      if (cur.s || !chars.length) lines.push(cur);
    }
    for (const ln of lines) {
      const P = ln.P;
      let best = 0, bn = -1; for (const [k, v] of ln.cnt) if (v > bn) { bn = v; best = k; }
      const ch = Object.assign({}, LJ.character || {}, P.base.character || {}), over = (P.recs[best] && P.recs[best].character) || {};
      for (const k of Object.keys(over)) ch[k] = typeof over[k] === 'object' && ch[k] && typeof ch[k] === 'object' ? Object.assign({}, ch[k], over[k]) : over[k];
      const para = Object.assign({}, LJ.paragraph || {}, P.base.paragraph || {}), lat = ch.latin || {};
      const font = cleanFont(lat.font), sizePt = (+(lat.size || ch.size || 0) || 120000) / 254000 * 72 * scale;
      let fill = '#000000'; const fj = ch.fill;
      if (fj && fj.type != null) fill = +fj.type === 0 ? null : (colorFromString(fj.primaryColor) || fill);
      const just = +(para.justify ?? 0), anchor = just === 2 ? 'middle' : just === 3 ? 'end' : 'start';
      const ol = ch.outline || {}, sw = +ol.width > 0 && ol.type !== '0' ? r4(+ol.width / 10000 * scale) : 0;
      const st = { font, size: r4(sizePt), weight: fontWeight(font, +lat.weight), italic: lat.italic === '1', underline: !!lat.underline && lat.underline !== '0', anchor, fill, lsp: (+(para.interLineSpacing || 1000000) / 1000000) || 1,
        stroke: sw ? colorFromString(ol.color) || '#000000' : null, sw: sw || 0.2 };
      const key = JSON.stringify([st.font, st.size, st.weight, st.italic, st.underline, st.anchor, st.fill, st.stroke, st.sw]);
      const last = blocks[blocks.length - 1];
      // espaçamento entre linhas diferente do padrão: cada linha vira um texto (o Draw usa 1,2em fixo)
      if (last && last.key === key && Math.abs(st.lsp - 1) <= 0.05) last.lines.push(ln.s); else blocks.push({ key, st, lines: [ln.s] });
    }
    if (!blocks.some(b => b.lines.join('').trim())) return [];
    // direções do texto na página
    const o0 = pageMap(ap(Mt, 0, 0)), ex = pageMap(ap(Mt, 1, 0)), ey = pageMap(ap(Mt, 0, -1));
    const nrm = (a, b) => { const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1; return { x: dx / l, y: dy / l }; };
    const right = nrm(o0, ex), down = nrm(o0, ey);
    let boxW = 0;
    if (isPara) {
      const fr = (T.frame && T.frame.columns ? T.frame : LJ.frame) || {}, col = fr.columns ? parseFloat(String(fr.columns).split(',')[0]) / 10000 : 0;
      boxW = col > 0 ? col * Math.hypot(Mt[0], Mt[3]) : Math.abs(R.coord(g, 4)) * Math.hypot(M[0], M[3]);
    }
    const out = [], th = rot * Math.PI / 180, cs = Math.cos(th), sn = Math.sin(th);
    let cursor = null, prevEm = 0, prevN = 0;
    for (const b of blocks) {
      const em = b.st.size * 25.4 / 72, lh = 1.2 * em;
      // linhas estimadas (o parágrafo quebra na largura do quadro)
      const n = isPara ? b.lines.reduce((a, l) => a + Math.max(1, Math.ceil(l.length * 0.5 * em / Math.max(1, boxW))), 0) : b.lines.length;
      cursor = cursor == null ? (isPara ? em * 0.9 * Math.min(1.2, Math.max(0.8, b.st.lsp)) : 0) : cursor + (prevN - 1) * 1.2 * prevEm + lh * b.st.lsp;
      const A = { x: o0.x + down.x * cursor, y: o0.y + down.y * cursor };
      // o Draw gira o texto em volta do centro da caixa: compensa para a linha de base cair no lugar certo
      let anchor = b.st.anchor, P0 = A;
      // texto artístico girado: centraliza na linha (o centro de giro do Draw passa a não depender da largura medida)
      if (rot && !isPara && anchor !== 'middle') { const w = Math.max(...b.lines.map(l => textWidth(l, b.st, em))); const k = anchor === 'end' ? -w / 2 : w / 2; P0 = { x: A.x + right.x * k, y: A.y + right.y * k }; anchor = 'middle'; }
      const wEst = isPara ? boxW : 0;
      const off = { x: wEst / 2, y: -0.8 * em + ((n - 1) * lh + em) / 2 };
      const pos = rot ? { x: P0.x - off.x + (off.x * cs - off.y * sn), y: P0.y - off.y + (off.x * sn + off.y * cs) } : P0;
      const o = { text: b.lines.join('\n'), font: b.st.font, size: b.st.size, weight: b.st.weight, italic: b.st.italic, underline: b.st.underline, anchor, fill: b.st.fill, stroke: b.st.stroke, sw: b.st.sw, x: r4(pos.x), y: r4(pos.y), rot };
      if (isPara) o.box = r4(Math.max(1, boxW));
      if (b.lines.join('').trim()) out.push(B.obj('text', o));
      prevEm = em; prevN = n;
    }
    return out;
  }

  /* ---------- páginas ---------- */
  async function buildObject(R, B, node, pageMap, warns) {
    if (node.id !== 'LIST') return null;
    if (node.list === 'grp ') {
      const kids = [];
      for (const k of [...node.kids].reverse()) { const o = await buildObject(R, B, k, pageMap, warns); if (o) kids.push(...[].concat(o)); }
      if (!kids.length) return null;
      if (kids.length === 1) return kids[0];
      return B.group(kids);
    }
    if (node.list !== 'obj ') return null;
    const lg = kid(node, 'LIST', 'lgob'), ld = lg ? kid(lg, 'loda') : kid(node, 'loda');
    if (!ld) return null;
    const L = readLoda(R, ld.data);
    let M = [1, 0, 0, 0, 1, 0];
    const tl = lg && kid(lg, 'LIST', 'trfl') || kid(node, 'LIST', 'trfl');
    if (tl) for (const t of kidsOf(tl, 'trfd')) M = mul(R.readTrfd(t.data), M);
    else { const t = lg && kid(lg, 'trfd') || kid(node, 'trfd'); if (t) M = R.readTrfd(t.data); }
    if (L.type === 4 || L.type === 6) {
      // o texto (txsm) costuma estar dentro do próprio objeto
      const tx = kid(node, 'txsm') || (lg && kid(lg, 'txsm'));
      const local = tx ? (R.ver >= 1600 ? R.readTxsm16(tx.data) : R.readTxsmOld(tx.data)) : null;
      return textObjs(R, B, L, M, pageMap, local);
    }
    // conteúdo de PowerClip e objetos internos: LISTs aninhados
    const inner = [];
    for (const k of [...node.kids].reverse()) if (k.id === 'LIST' && (k.list === 'grp ' || k.list === 'obj ')) { const o = await buildObject(R, B, k, pageMap, warns); if (o) inner.push(...[].concat(o)); }
    // PowerClip da X6+: o argumento 0x1f45 aponta para um grupo da tabela 'clpt' com o conteúdo
    const pc = L.args.get(0x1f45);
    if (pc && pc.length >= 4 && R.clips.has(u32(pc, 0)) && R.clipDepth < 8) {
      const cg = R.clips.get(u32(pc, 0));
      R.clipDepth++;
      try {
        for (const k of [...cg.kids].reverse()) if (k.id === 'LIST' && (k.list === 'grp ' || k.list === 'obj ')) { const o = await buildObject(R, B, k, pageMap, warns); if (o) inner.push(...[].concat(o)); }
      } finally { R.clipDepth--; }
    }
    const sh = await shapeFrom(R, B, L, M, warns);
    if (!sh) {
      if (![0, 11, 12, 17].includes(L.type)) R.unknown.set(L.type, (R.unknown.get(L.type) || 0) + 1);
      return inner.length ? inner : null;
    }
    const W = (x, y) => pageMap(ap(M, x, y));
    if (sh.image) {
      const c = sh.corners.map(p => W(p.x, p.y));
      const w = Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y), h = Math.hypot(c[3].x - c[0].x, c[3].y - c[0].y);
      const cx = (c[0].x + c[2].x) / 2, cy = (c[0].y + c[2].y) / 2, rot = Math.atan2(c[1].y - c[0].y, c[1].x - c[0].x) * 180 / Math.PI;
      const flip = (c[1].x - c[0].x) * (c[3].y - c[0].y) - (c[1].y - c[0].y) * (c[3].x - c[0].x) < 0;
      const img = B.obj('image', { x: r4(cx - w / 2), y: r4(cy - h / 2), w: r4(w), h: r4(h), asset: sh.aid, rot: Math.abs(rot) > 0.01 ? r4(rot) : 0 });
      if (flip) img.fy = true;
      return inner.length ? B.group([img, ...inner], true) : img;
    }
    const st = styleOf(R, L, M);
    const props = { fill: st.fill === undefined ? null : st.fill, stroke: st.stroke || null, sw: st.stroke ? st.sw : 0.2, opacity: st.opacity };
    if (st.transp) props.transp = st.transp;
    if (st.cap) props.cap = st.cap; if (st.join) props.join = st.join; if (st.behind) props.behind = true; if (st.dash) props.dash = st.dash;
    const flipY = true;
    if (props.fill && props.fill.cdrGrad) props.fill = gradFill(props.fill, flipY);
    let o;
    const axis = Math.abs(M[1]) < 1e-9 && Math.abs(M[3]) < 1e-9;
    if (sh.local && axis && (sh.local.kind === 'rect' || (sh.local.kind === 'ellipse' && sh.local.full))) {
      const p0 = W(0, 0), p1 = W(sh.local.w, sh.local.h);
      const box = { x: r4(Math.min(p0.x, p1.x)), y: r4(Math.min(p0.y, p1.y)), w: r4(Math.abs(p1.x - p0.x)), h: r4(Math.abs(p1.y - p0.y)) };
      if (sh.local.kind === 'rect') o = B.obj('rect', Object.assign(box, props, { rx: r4((sh.local.r || 0) * Math.min(Math.abs(M[0]), Math.abs(M[4]))) }));
      else o = B.obj('ellipse', Object.assign(box, props));
    } else {
      const subs = mapSubs(sh.subs, W);
      if (!subs.length) return inner.length ? inner : null;
      if (subs.every(s => !s.closed) && props.fill) props.fill = null;
      o = B.obj('path', Object.assign({ subs }, props));
    }
    // objeto com outros dentro = PowerClip: o 1º filho do grupo recorta os demais
    return inner.length ? B.group([o, ...inner], true) : o;
  }

  async function parse(input, opts = {}) {
    const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
    const warnings = new Set(), out = { pages: [], assets: {}, warnings: [], nextId: opts.nextId || 1 };
    let zip = null, rootBytes = null, streams = null;
    if (u8[0] === 0x50 && u8[1] === 0x4b) {
      try { zip = readZip(u8); } catch { throw new Error('Este arquivo .cdr está incompleto ou corrompido.'); }
      if (zip.has('content/root.dat')) {
        rootBytes = await zip.get('content/root.dat');
        const lst = zip.has('content/dataFileList.dat') ? td8.decode(await zip.get('content/dataFileList.dat')).split(/\r?\n/).map(s => s.trim()).filter(Boolean) : [];
        streams = []; for (const n of lst) streams.push((await zip.get('content/data/' + n)) || new Uint8Array(0));
      } else if (zip.has('content/riffData.cdr')) rootBytes = await zip.get('content/riffData.cdr');
    } else if (fourcc(u8, 0) === 'RIFF') rootBytes = u8;
    else throw new Error('Este arquivo não parece ser do CorelDRAW (.cdr).');

    let ok = false;
    if (rootBytes && fourcc(rootBytes, 0) === 'RIFF') {
      try { ok = await parseDoc(rootBytes, streams, out, warnings); } catch (e) { warnings.add('Parte do arquivo não pôde ser lida: ' + (e && e.message || e)); }
    }
    // reserva: a pré-visualização que o CorelDRAW grava no arquivo
    const fallbackPage = async (i, page) => {
      let png = null;
      if (zip) png = (await zip.get(`previews/page${i + 1}.png`)) || (i === 0 ? await zip.get('previews/thumbnail.png') : null) || (i === 0 ? await zip.get('metadata/thumbnails/thumbnail.bmp') : null);
      if (!png && out.dispBmp && i === 0) png = out.dispBmp;
      if (!png) return false;
      const isBmp = png[0] === 0x42 && png[1] === 0x4d, aid = 'acdrprev' + Date.now().toString(36) + i;
      out.assets[aid] = (isBmp ? 'data:image/bmp;base64,' : 'data:image/png;base64,') + b64(png);
      let w = page ? page.w : 210, h = page ? page.h : 297;
      if (!page && !isBmp && png.length > 24) { const pw = (png[16] << 24 | png[17] << 16 | png[18] << 8 | png[19]) >>> 0, ph = (png[20] << 24 | png[21] << 16 | png[22] << 8 | png[23]) >>> 0; if (pw > 0 && ph > 0) h = Math.round(210 * ph / pw * 1000) / 1000; }
      page = page || { name: `Página ${i + 1}`, w, h, objs: [] };
      page.objs = [{ id: out.nextId++, type: 'image', name: 'Pré-visualização do CorelDRAW', x: 0, y: 0, w, h, asset: aid, rot: 0, hidden: false, locked: false, fill: null, stroke: null, sw: 0.2, dash: 'solid', join: 'miter', cap: 'butt', behind: false, arrowS: false, arrowE: false, opacity: 1, shadow: null }];
      return page;
    };
    if (!ok || !out.pages.length) {
      const pv = zip ? zip.names().filter(n => /^previews\/page\d+\.png$/.test(n)).length : 0;
      out.pages = [];
      for (let i = 0; i < Math.max(1, pv); i++) { const p = await fallbackPage(i, null); if (p) out.pages.push(p); }
      if (!out.pages.length) throw new Error('Não consegui ler este arquivo do CorelDRAW. Abra-o no CorelDRAW e exporte em SVG ou PDF.');
      warnings.add('Não consegui ler os objetos deste arquivo: cada página entrou como imagem (a pré-visualização gravada pelo CorelDRAW).');
    } else {
      for (let i = 0; i < out.pages.length; i++) if (!out.pages[i].objs.length) {
        if (await fallbackPage(i, out.pages[i])) warnings.add(`A página ${i + 1} entrou como imagem (pré-visualização do CorelDRAW): não consegui ler os objetos dela.`);
      }
    }
    delete out.dispBmp;
    out.warnings = [...warnings];
    return out;
  }

  async function parseDoc(rootBytes, streams, out, warnings) {
    const ctx = { streams };
    let tree = parseRiff(rootBytes, ctx);
    await expandCmpr(tree, ctx);
    tree = flatten(tree);
    const R0 = tree.find(n => n.id === 'RIFF') || { kids: tree };
    // versão
    let ver = 0;
    const vr = [...all(R0, 'vrsn')][0];
    if (vr) ver = u16(vr.data, 0);
    else { const ch = String.fromCharCode(rootBytes[11]); ver = /[0-9]/.test(ch) ? +ch * 100 : (ch.charCodeAt(0) - 55) * 100; }
    if (!(ver >= 300)) ver = 1600;
    const R = new Reader(ver), B = new Builder(R, out.nextId);
    // dados do documento
    for (const n of all(R0, 'fild')) R.readFild(n.data);
    for (const n of all(R0, 'outl')) R.readOutl(n.data);
    for (const n of all(R0, 'bmp ')) R.readBmp(n.data);
    for (const n of all(R0, 'font')) R.readFont(n.data);
    for (const n of all(R0, 'txsm')) { if (ver >= 1600) R.readTxsm16(n.data); else R.readTxsmOld(n.data); }
    const disp = [...all(R0, 'DISP')][0];
    if (disp) { // miniatura DIB antiga → BMP
      const dib = disp.data.subarray(4), hs = u32(dib, 0), bpp = u16(dib, 14), nc = u32(dib, 32) || (bpp <= 8 ? 1 << bpp : 0);
      const bmp = new Uint8Array(14 + dib.length), v = dv(bmp); bmp[0] = 0x42; bmp[1] = 0x4d; v.setUint32(2, bmp.length, true); v.setUint32(10, 14 + hs + nc * 4, true); bmp.set(dib, 14);
      out.dispBmp = bmp;
    }
    // páginas: a 1ª é a página-mestre (camadas mestras aparecem em todas)
    const pages = [...all(R0, 'LIST', 'page')];
    if (!pages.length) return false;
    const layersOf = pg => { const go = kid(pg, 'LIST', 'gobj'); return kidsOf(go || pg, 'LIST', 'layr'); };
    const layerType = ly => { const lg = kid(ly, 'LIST', 'lgob'), ld = lg ? kid(lg, 'loda') : kid(ly, 'loda'); return ld ? u32(ld.data, 16) : 0; };
    const layerFlags = ly => { const f = kid(ly, 'flgs'); return f ? u32(f.data, 0) : 0; };
    const master = pages[0], real = pages.slice(1).length ? pages.slice(1) : pages;
    const pageSize = pg => {
      for (const n of [pg, kid(pg, 'LIST', 'lgob')]) for (const ld of n ? kidsOf(n, 'loda') : []) {
        const a = readLoda(R, ld.data).args.get(0x4aba);
        if (a && a.length >= 8) { const w = s32(a, 0) / 10000, h = s32(a, 4) / 10000; if (w > 1 && h > 1) return { w, h }; }
      }
      return null;
    };
    // conteúdo das PowerClips (X6+): grupos na tabela 'clpt', ligados pelo número do 'spnd'
    for (const cl of all(R0, 'LIST', 'clpt')) for (const g of cl.kids || []) { const s = kid(g, 'spnd'); if (s) R.clips.set(u32(s.data, 0), g); }
    let skipped = 0;
    const masterLayers = pages.length > 1 ? layersOf(master).filter(ly => layerType(ly) === 0 && ly.kids.some(k => k.id === 'LIST' && (k.list === 'obj ' || k.list === 'grp '))) : [];
    for (let pi = 0; pi < real.length; pi++) {
      const pg = real[pi];
      const bb = kid(pg, 'bbox');
      let x0 = -105, y0 = 148.5, x1 = 105, y1 = -148.5;
      if (bb && bb.data.length >= 16) { x0 = R.coord(bb.data, 0); y0 = R.coord(bb.data, R.csz); x1 = R.coord(bb.data, 2 * R.csz); y1 = R.coord(bb.data, 3 * R.csz); }
      if (Math.abs(x1 - x0) < 1 || Math.abs(y1 - y0) < 1) { // sem caixa: usa a do mestre ou A4
        const mb = kid(master, 'bbox'); if (mb && mb.data.length >= 16 && Math.abs(R.coord(mb.data, 8) - R.coord(mb.data, 0)) > 1) { x0 = R.coord(mb.data, 0); y0 = R.coord(mb.data, 4); x1 = R.coord(mb.data, 8); y1 = R.coord(mb.data, 12); }
      }
      // tamanho real da página: argumento 0x4aba do loda da própria página (a caixa 'bbox' inclui objetos fora dela)
      const ps = pageSize(pg) || pageSize(master);
      if (ps) { x0 = -ps.w / 2; x1 = ps.w / 2; y0 = ps.h / 2; y1 = -ps.h / 2; }
      const left = Math.min(x0, x1), top = Math.max(y0, y1), W = Math.abs(x1 - x0), H = Math.abs(y1 - y0);
      // objeto que fica todo fora da página (na área de trabalho do Corel) não entra
      const offPage = k => { const b = kid(k, 'bbox'); if (!b || b.data.length < 16) return false; const xs = [R.coord(b.data, 0), R.coord(b.data, 2 * R.csz)], ys = [R.coord(b.data, R.csz), R.coord(b.data, 3 * R.csz)]; return Math.max(...xs) < left - 0.01 || Math.min(...xs) > left + W + 0.01 || Math.min(...ys) > top + 0.01 || Math.max(...ys) < top - H - 0.01; };
      const pageMap = p => ({ x: p.x - left, y: top - p.y });
      const objs = [];
      const layers = layersOf(pg).filter(ly => layerType(ly) === 0 && !(layerFlags(ly) & 0x00010000));
      // camadas: a primeira da lista é a de cima
      for (const ly of [...layers, ...masterLayers].reverse()) {
        for (const k of [...ly.kids].reverse()) {
          if (k.id === 'LIST' && offPage(k)) { skipped++; continue; }
          const o = await buildObject(R, B, k, pageMap, warnings); if (o) objs.push(...[].concat(o));
        }
      }
      out.pages.push({ name: `Página ${pi + 1}`, w: Math.round(W * 1000) / 1000, h: Math.round(H * 1000) / 1000, objs });
    }
    if (skipped) warnings.add(`Ficaram de fora ${skipped} objeto(s) que estavam fora da página, na área de trabalho do CorelDRAW.`);
    for (const w of R.warn) warnings.add(w);
    if (R.unknown.size) warnings.add('Alguns efeitos do CorelDRAW (como mistura, contorno, tabelas ou conectores) não têm equivalente e ficaram de fora.');
    Object.assign(out.assets, B.assets);
    out.nextId = B.id;
    return true;
  }

  const api = { parse };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.DrawCDR = api;
  else if (root) root.DrawCDR = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);