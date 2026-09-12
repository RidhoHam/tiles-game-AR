#!/usr/bin/env node
/**
 * build-card-sheet.mjs - Membangun ulang public/cards/lembar-a4.svg dari enam kartu sumber.
 *
 * Masalah yang diperbaiki (temuan I1 dari Task 3): lembar A4 menyalin (inline) isi
 * keenam berkas kartu SVG. Tanpa skrip, mengubah salah satu kartu akan membuat lembar
 * A4 "melenceng" diam-diam dari kartu aslinya. Skrip ini adalah SATU-SATUNYA sumber
 * kebenaran untuk mengisi ulang lembar tersebut.
 *
 * Keluaran: public/cards/lembar-a4.svg
 *   - A4 potrait 210 x 297 mm (viewBox 0 0 210 297, jadi 1 satuan = 1 mm).
 *   - Susunan 3 kolom x 2 baris: kolom 1 -> benteng, bunker, robot;
 *     kolom 2 -> tank, kesatria, gargoyle (baris 1: benteng/bunker/robot,
 *     baris 2: tank/kesatria/gargoyle).
 *   - Setiap kartu diskalakan seragam agar pas 63.52941 x 90 mm (perbandingan
 *     600:850 = 63.52941:90, sama dengan skala 1:0.10588 yang dipakai lembar lama).
 *   - Tanda potong putus-putus plus tanda sudut di sekeliling setiap kartu.
 *
 * Isi tiap kartu diambil APA ADANYA dari public/cards/<nama>.svg (isi dalam <svg>,
 * tanpa elemen <svg> pembungkusnya), sehingga mengubah kartu lalu menjalankan skrip
 * ini selalu menyinkronkan lembar A4.
 *
 * Jalankan: node scripts/build-card-sheet.mjs
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');

export const CARD_DIR = join(projectRoot, 'public', 'cards');
export const SHEET_FILE = join(CARD_DIR, 'lembar-a4.svg');

/** Ukuran asli setiap gambar kartu (px). */
export const CARD_WIDTH = 600;
export const CARD_HEIGHT = 850;

/** Ukuran cetak satu kartu di lembar A4, dalam mm (perbandingan 600:850). */
export const CARD_MM_WIDTH = 63.52941;
export const CARD_MM_HEIGHT = 90;
export const CARD_SCALE = CARD_MM_WIDTH / CARD_WIDTH; // 0.10588235

/** Grid: 3 kolom x 2 baris. Urutan ini sama dengan CARD_TARGETS/CARD_SOURCES. */
export const SHEET_GRID = Object.freeze([
  { name: 'benteng.svg', cardId: 'benteng', role: 'base', row: 0, col: 0 },
  { name: 'bunker.svg', cardId: 'bunker', role: 'base', row: 0, col: 1 },
  { name: 'robot.svg', cardId: 'robot', role: 'artileri', row: 0, col: 2 },
  { name: 'tank.svg', cardId: 'tank', role: 'artileri', row: 1, col: 0 },
  { name: 'kesatria.svg', cardId: 'kesatria', role: 'prajurit', row: 1, col: 1 },
  { name: 'gargoyle.svg', cardId: 'gargoyle', role: 'prajurit', row: 1, col: 2 }
]);

/** Tata letak di dalam halaman A4 (mm). Nilai ini mereproduksi lembar lama. */
export const SHEET_LAYOUT = Object.freeze({
  pageWidth: 210,
  pageHeight: 297,
  originX: 7.70588, // x kartu pertama
  originY: 79,      // y kartu baris pertama
  pitchX: 65.52941, // jarak antar kolom (63.52941 + 2 jarak)
  pitchY: 97        // jarak antar baris (90 + 7 jarak)
});

const clean = (value) => String(value);

/**
 * Mengambil isi dalam elemen <svg> (tanpa pembungkus <svg ...> dan </svg>).
 * Mendukung berkas dengan maupun tanpa deklarasi XML / komentar di depan.
 */
export function extractSvgContent(source) {
  const open = source.indexOf('<svg');
  if (open === -1) throw new Error('Berkas kartu tidak memuat elemen <svg>.');
  const openEnd = source.indexOf('>', open);
  if (openEnd === -1) throw new Error('Tag <svg> tidak ditutup.');
  const close = source.lastIndexOf('</svg>');
  if (close === -1) throw new Error('Berkas kartu tidak memuat </svg>.');
  return source.slice(openEnd + 1, close).trim();
}

/** Menghitung posisi mm satu kartu di halaman. */
export function cardPlacement(index) {
  const cell = SHEET_GRID[index];
  return {
    ...cell,
    x: SHEET_LAYOUT.originX + cell.col * SHEET_LAYOUT.pitchX,
    y: SHEET_LAYOUT.originY + cell.row * SHEET_LAYOUT.pitchY
  };
}

/** Satu blok kartu: bingkai tak terlihat, isi kartu, tanda potong, dan label. */
function renderCardBlock(index, content) {
  const { x, y, cardId, role } = cardPlacement(index);
  const w = CARD_MM_WIDTH;
  const h = CARD_MM_HEIGHT;
  const right = x + w;
  const bottom = y + h;
  const gap = 1.4; // jarak bingkai ke garis potong
  const tick = 4;  // panjang tanda sudut
  const n = (value) => Number(value.toFixed(5));

  return [
    `  <g><title>${clean(cardId)} (${clean(role)})</title>` +
      `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="none"/>` +
      `<g transform="translate(${n(x)} ${n(y)}) scale(${CARD_SCALE.toFixed(5)})">${content}</g></g>` +
      // garis potong putus-putus
      `<g fill="none" stroke="#444" stroke-width="0.25" stroke-dasharray="1.2 1.2">` +
      `<path d="M${n(x - gap)} ${n(y)} v${n(h)} M${n(right + gap)} ${n(y)} v${n(h)} ` +
      `M${n(x)} ${n(y - gap)} h${w} M${n(x)} ${n(bottom + gap)} h${w}"/></g>` +
      // tanda sudut
      `<g fill="none" stroke="#888" stroke-width="0.3" stroke-linecap="round">` +
      `<path d="M${n(x - gap - 0.2)} ${n(y)} h-4"/><path d="M${n(x)} ${n(y - gap - 0.2)} v-4"/>` +
      `<path d="M${n(right + gap + 0.2)} ${n(y)} h4"/><path d="M${n(right)} ${n(y - gap - 0.2)} v-4"/>` +
      `<path d="M${n(x - gap - 0.2)} ${n(bottom)} h-4"/><path d="M${n(x)} ${n(bottom + gap + 0.2)} v4"/>` +
      `<path d="M${n(right + gap + 0.2)} ${n(bottom)} h4"/><path d="M${n(right)} ${n(bottom + gap + 0.2)} v4"/>` +
      `</g>` +
      `<text x="${n(x + w / 2)}" y="${n(bottom + gap + 3.2)}" text-anchor="middle" ` +
      `font-family="Verdana, Geneva, sans-serif" font-size="2.6" fill="#666">${clean(cardId)} - ${clean(role).toUpperCase()}</text>`
  ].join('');
}

/** Membangun seluruh isi lembar A4. */
export function buildSheet(contents) {
  if (contents.length !== SHEET_GRID.length) {
    throw new Error(`Butuh ${SHEET_GRID.length} isi kartu, diterima ${contents.length}.`);
  }

  const firstX = SHEET_LAYOUT.originX - 2.7;
  const firstY = SHEET_LAYOUT.originY - 3;
  const gridW = CARD_MM_WIDTH * 3 + 2 * (SHEET_LAYOUT.pitchX - CARD_MM_WIDTH);
  const gridH = CARD_MM_HEIGHT * 2 + (SHEET_LAYOUT.pitchY - CARD_MM_HEIGHT);
  const n = (value) => Number(value.toFixed(5));

  const header = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 210 297" role="img" aria-labelledby="sheetTitle">',
    '  <title id="sheetTitle">Lembar A4 - enam kartu Perang Pasir siap potong</title>',
    '  <defs>',
    '    <style>',
    "      .sheetTitle { font-family: Georgia, 'Times New Roman', serif; font-weight: 700; }",
    '      .sheetText { font-family: Verdana, Geneva, sans-serif; }',
    '    </style>',
    '  </defs>',
    '',
    '  <rect x="0" y="0" width="210" height="297" fill="#ffffff"/>',
    '',
    '  <g class="sheetTitle">',
    '    <text x="105" y="14" text-anchor="middle" font-size="7" letter-spacing="0.6">PERANG PASIR - LEMBAR KARTU</text>',
    '  </g>',
    '  <g class="sheetText">',
    '    <text x="105" y="20" text-anchor="middle" font-size="3.4" fill="#333">Cetak pada skala 100 persen (tanpa &quot;fit to page&quot;) di kertas A4. Potong mengikuti garis putus-putus.</text>',
    '  </g>',
    '',
    `  <rect x="${n(firstX)}" y="${n(firstY)}" width="${n(gridW)}" height="${n(gridH)}" fill="none" stroke="#bbb" stroke-width="0.3" stroke-dasharray="2 1.4"/>`,
    ''
  ].join('\n');

  const blocks = contents.map((content, index) => renderCardBlock(index, content)).join('\n');

  const footer = [
    '',
    '  <g class="sheetText" fill="#333">',
    '    <line x1="14" y1="278" x2="196" y2="278" stroke="#bbb" stroke-width="0.3"/>',
    `    <text x="14" y="284" font-size="3.4">Petunjuk: setiap kartu berukuran ${CARD_MM_WIDTH} x ${CARD_MM_HEIGHT} mm setelah dipotong. Enam kartu: benteng, bunker (base); robot, tank (artileri); kesatria, gargoyle (prajurit).</text>`,
    '    <text x="14" y="289.4" font-size="3.2" fill="#555">Susun tiga kartu di kiri garis tengah dan tiga kartu di kanan, dengan tepat satu base, satu artileri, dan satu prajurit per sisi.</text>',
    '    <text x="14" y="294.8" font-size="3.2" fill="#555">Gunakan cahaya rata tanpa kilau, dan pastikan seluruh kartu terlihat oleh kamera webcam.</text>',
    '  </g>',
    '',
    '  <text x="196" y="292" text-anchor="end" class="sheetText" font-size="2.6" fill="#888">Lembar dibuat oleh scripts/build-card-sheet.mjs</text>',
    '</svg>',
    ''
  ].join('\n');

  return `${header}\n${blocks}\n${footer}`;
}

/** Membaca keenam berkas kartu dan mengembalikan isinya sesuai urutan grid. */
export async function readCardContents(dir = CARD_DIR) {
  const contents = [];
  for (const cell of SHEET_GRID) {
    const file = join(dir, cell.name);
    let source;
    try {
      source = await readFile(file, 'utf8');
    } catch {
      throw new Error(`Gambar kartu tidak ditemukan: ${relative(projectRoot, file).split('\\').join('/')}`);
    }
    contents.push(extractSvgContent(source));
  }
  return contents;
}

export async function main() {
  console.log('build-card-sheet: membangun ulang lembar A4 dari keenam kartu');
  console.log(`  folder sumber : ${relative(projectRoot, CARD_DIR).split('\\').join('/')}`);
  console.log(`  berkas keluaran: ${relative(projectRoot, SHEET_FILE).split('\\').join('/')}`);
  console.log('');

  const contents = await readCardContents();
  for (const [index, cell] of SHEET_GRID.entries()) {
    const place = cardPlacement(index);
    console.log(
      `  [ok] public/cards/${cell.name}  -> baris ${place.row + 1} kolom ${place.col + 1} ` +
      `(x=${place.x.toFixed(2)}mm y=${place.y.toFixed(2)}mm)`
    );
  }

  const sheet = buildSheet(contents);
  await writeFile(SHEET_FILE, sheet, 'utf8');

  const placed = 6;
  console.log('');
  console.log(`Selesai: ${placed} kartu pada ${CARD_MM_WIDTH} x ${CARD_MM_HEIGHT} mm (A4 potrait 210 x 297 mm, 3 kolom x 2 baris).`);
  return 0;
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main()
    .then((code) => { process.exitCode = code; })
    .catch((error) => {
      console.error('build-card-sheet: gagal.');
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}