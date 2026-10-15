<p align="center">
  <img src="installer/draw.png" alt="Draw" width="120">
</p>

<h1 align="center">Draw</h1>

<p align="center">
  <b>Editor vetorial gratuito, em português, que roda no navegador, no Windows e no Linux.</b><br>
  Sem cadastro, sem assinatura e sem mandar seus desenhos para servidor nenhum.
</p>

<p align="center">
  <a href="https://draw.mais.live"><b>▶ Usar agora no navegador</b></a> ·
  <a href="https://draw.mais.live/downloads/Draw-Setup.exe">Baixar para Windows</a> ·
  <a href="https://draw.mais.live/downloads/draw_1.0.0_amd64.deb">Baixar para Linux</a>
</p>

<p align="center">
  <img alt="Versão" src="https://img.shields.io/badge/vers%C3%A3o-1.0.0-2563eb">
  <img alt="Licença MIT" src="https://img.shields.io/badge/licen%C3%A7a-MIT-16a34a">
  <img alt="Plataformas" src="https://img.shields.io/badge/Windows%20%7C%20Linux%20%7C%20navegador-gray">
  <img alt="Idioma" src="https://img.shields.io/badge/idioma-portugu%C3%AAs-f59e0b">
</p>

---

## Por que o Draw?

Quem trabalha com comunicação visual, gráfica rápida, convites, adesivos ou corte a laser precisa de um editor vetorial de verdade, e quase todos são pagos, pesados ou em inglês. O Draw é leve (3 MB), abre em segundos e usa os atalhos e as ferramentas que quem vem do mundo gráfico já conhece.

- **Grátis e de código aberto** (licença MIT)
- **Funciona offline**: depois da primeira visita, o site abre sem internet; o programa nunca precisa dela
- **Privado**: os projetos ficam no seu computador ou no seu navegador
- **Abre arquivos `.cdr`** (páginas, curvas, cores, textos e imagens), além de SVG e imagens
- **Exporta para gráfica**: PDF vetorial, SVG, EPS e PNG

## Ferramentas

| Grupo | O que tem |
|---|---|
| Desenho | Seleção, forma, mão livre, caneta (Bézier), linha, retângulo, elipse, polígono, estrela, espiral, texto |
| Edição | Faca, borracha, recortar, editar nós, PowerClip, grade, cotas |
| Efeitos | Sombreamento, contorno concêntrico, mistura, distorção, extrusão, transparência, lentes |
| Cor | Preenchimento interativo, conta-gotas de atributos, paleta com cores de processo (CMYK aproximado) |
| Organização | Várias páginas, gerenciador de objetos (ocultar, travar, renomear), guias, encaixe, alinhar e distribuir |
| Arquivos | Projeto `.draw`, importar `.cdr` / `.svg` / PNG / JPG / WebP, exportar PDF, SVG, EPS, PNG e pacote `.zip` |

Atalhos de teclado conhecidos: `F2`/`F3` zoom, `F12` caneta de contorno, `Shift+F11` preenchimento, `Ctrl+J` opções, `L`/`R`/`T`/`B`/`C`/`E`/`P` para alinhar, e por aí vai.

## Download

| Sistema | Arquivo | Observação |
|---|---|---|
| Windows 10 e 11 | [Draw-Setup.exe](https://draw.mais.live/downloads/Draw-Setup.exe) | Instalador, não pede administrador |
| Windows (portátil) | [Draw-Windows.exe](https://draw.mais.live/downloads/Draw-Windows.exe) | Abre sem instalar |
| Ubuntu, Debian, Mint | [draw_1.0.0_amd64.deb](https://draw.mais.live/downloads/draw_1.0.0_amd64.deb) | `sudo apt install ./draw_1.0.0_amd64.deb` |
| Outras distribuições Linux | [draw-1.0.0-linux-x64.tar.gz](https://draw.mais.live/downloads/draw-1.0.0-linux-x64.tar.gz) | Extraia e rode `./install.sh` |
| Qualquer sistema | [draw.mais.live](https://draw.mais.live) | Pelo navegador; dá para instalar como aplicativo |

> **Aviso do Windows (SmartScreen):** como o programa ainda não tem assinatura digital paga, o Windows pode mostrar "O Windows protegeu o computador". Clique em **Mais informações › Executar assim mesmo**.

## Como compilar

O editor inteiro é um único arquivo, `src/draw.html`. O programa de computador usa o [Neutralinojs](https://neutralino.js.org) com o WebView do sistema (WebView2 no Windows, WebKitGTK no Linux), por isso fica tão pequeno.

Requisitos: Windows com PowerShell e [Node.js](https://nodejs.org).

```powershell
cd installer\tools
npm install
cd ..
powershell -ExecutionPolicy Bypass -File build-all.ps1 -App <pasta do draw-app> -Site <pasta de saída do site>
```

O script gera, a partir de `src/draw.html`:

- os executáveis para Windows, Linux e macOS (`dist/`)
- o instalador do Windows (Inno Setup)
- os pacotes `.deb` e `.tar.gz` para Linux
- o site estático, pronto para qualquer hospedagem

## Estrutura

```
src/draw.html            o editor (fonte única)
resources/               o que vai embutido no programa
  lib/cdr-import.js      leitor de arquivos .cdr
  lib/paper-core.min.js  motor vetorial (paper.js)
  lib/jspdf, svg2pdf     exportação para PDF
installer/               scripts de build, instalador e ícones
neutralino.config.json   configuração da janela do programa
```

## Contribua

Achou um bug ou sentiu falta de uma ferramenta? Abra uma [issue](../../issues). Pull requests são bem-vindos.

Se o Draw te ajudou, deixe uma ⭐ no repositório e mostre para quem trabalha com design: é o que faz o projeto chegar a mais gente.

## Licença

[MIT](LICENSE). Feito com [Neutralinojs](https://neutralino.js.org), [paper.js](http://paperjs.org), [jsPDF](https://github.com/parallax/jsPDF) e [svg2pdf.js](https://github.com/yWorks/svg2pdf.js).

CorelDRAW é marca registrada da Corel Corporation. O Draw não tem nenhuma ligação com a Corel; o nome aparece aqui só para indicar compatibilidade de arquivos.
