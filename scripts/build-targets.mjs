#!/usr/bin/env node
/**
 * build-targets.mjs - Menyiapkan berkas target MindAR untuk enam kartu Perang Pasir.
 *
 * PENTING: MindAR TIDAK menyediakan compiler resmi untuk Node.js. Berkas
 * `targets.mind` hanya dapat dibuat dengan Image Target Compiler milik MindAR yang
 * berjalan di browser. Skrip ini TIDAK berpura-pura mengompilasi apa pun:
 *
 *   - Memeriksa apakah public/cards/targets.mind sudah ada.
 *   - Memastikan enam berkas SVG sumber ada, dan melaporkan yang hilang.
 *   - Bila berkas target belum ada, mencetak instruksi langkah demi langkah yang
 *     dapat langsung dijalankan, lalu keluar dengan kode NON-NOL agar CI maupun
 *     manusia menyadarinya.
 *   - Bila berkas target sudah ada, mencetak konfirmasi dan keluar dengan kode 0.
 *
 * Jalankan: node scripts/build-targets.mjs
 */

import { access, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');

export const CARD_DIR = join(projectRoot, 'public', 'cards');
export const TARGET_FILE = join(CARD_DIR, 'targets.mind');

/** Urutan ini HARUS sama dengan CARD_TARGETS di src/ar/card-targets.js. */
export const CARD_SOURCES = Object.freeze([
  { name: 'benteng.svg', cardId: 'benteng', type: 'benteng', role: 'base' },
  { name: 'bunker.svg', cardId: 'bunker', type: 'bunker', role: 'base' },
  { name: 'robot.svg', cardId: 'robot', type: 'robot', role: 'artileri' },
  { name: 'tank.svg', cardId: 'tank', type: 'tank', role: 'artileri' },
  { name: 'kesatria.svg', cardId: 'kesatria', type: 'kesatria', role: 'prajurit' },
  { name: 'gargoyle.svg', cardId: 'gargoyle', type: 'gargoyle', role: 'prajurit' }
]);

const COMPILER_URL = 'https://hiukim.github.io/mind-ar-js-doc/tools/compile';

const exists = async (path) => {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

async function checkSources() {
  const present = [];
  const missing = [];
  for (const card of CARD_SOURCES) {
    const file = join(CARD_DIR, card.name);
    if (await exists(file)) {
      const info = await stat(file);
      present.push({ ...card, bytes: info.size });
    } else {
      missing.push(card);
    }
  }
  return { present, missing };
}

function printMissingInstructions(missing) {
  console.error('  Langkah-langkah:');
  console.error(`    1. Buka Image Target Compiler MindAR di browser:`);
  console.error(`         ${COMPILER_URL}`);
  console.error('       (butuh koneksi internet; berjalan sepenuhnya di browser, tidak ada');
  console.error('        berkas yang diunggah ke server).');
  console.error('    2. Seret KEENAM berkas ini ke area unggah, DALAM URUTAN INI:');
  CARD_SOURCES.forEach((card, index) => {
    const target = join(CARD_DIR, card.name);
    console.error(`         ${index + 1}. ${relative(projectRoot, target).split('\\').join('/')}  (${card.cardId} - ${card.role})`);
  });
  console.error('       Urutan menentukan indeks target, dan indeks itu dipetakan ke tipe unit');
  console.error('       oleh CARD_TARGETS di src/ar/card-targets.js. Jangan diacak.');
  console.error('    3. Tunggu sampai semua gambar selesai diproses, lalu klik "Download".');
  console.error('    4. Simpan berkas hasil unduhan dengan nama TEPAT "targets.mind", lalu');
  console.error('       letakkan di folder berikut (timpa berkas lama bila ada):');
  console.error(`         ${relative(projectRoot, TARGET_FILE).split('\\').join('/')}`);
  console.error('    5. Jalankan lagi: node scripts/build-targets.mjs');
  console.error('       Skrip akan mengonfirmasi berkas target dan keluar dengan kode 0.');
  if (missing.length > 0) {
    console.error('');
    console.error('  Perhatian: gambar sumber berikut belum ada, jadi tidak bisa diseret:');
    for (const card of missing) console.error(`         - public/cards/${card.name}`);
    console.error('    Buat dulu keenam gambar kartu sebelum mengompilasi target.');
  }
}

function printPresentInstructions() {
  console.log('  Cara mengompilasi (bila perlu memperbarui):');
  console.log(`    1. Buka ${COMPILER_URL}`);
  console.log('    2. Seret keenam berkas berikut, dalam urutan ini:');
  CARD_SOURCES.forEach((card, index) => {
    console.log(`         ${index + 1}. public/cards/${card.name}  (${card.cardId} - ${card.role})`);
  });
  console.log('    3. Klik Download, simpan sebagai "targets.mind", lalu timpa berkas di');
  console.log('       public/cards/targets.mind.');
}

async function main() {
  console.log('build-targets: memeriksa berkas target MindAR untuk Perang Pasir');
  console.log(`  folder sumber : ${relative(projectRoot, CARD_DIR).split('\\').join('/')}`);
  console.log(`  berkas target : ${relative(projectRoot, TARGET_FILE).split('\\').join('/')}`);
  console.log('');

  const { present, missing } = await checkSources();

  if (present.length > 0) {
    console.log(`Gambar sumber ditemukan (${present.length}/${CARD_SOURCES.length}):`);
    for (const card of present) {
      console.log(`  [ok] public/cards/${card.name}  ${card.bytes} byte  (${card.role})`);
    }
  }

  if (missing.length > 0) {
    console.error('');
    console.error(`Gambar sumber HILANG (${missing.length}):`);
    for (const card of missing) console.error(`  [xx] public/cards/${card.name}`);
  }
  console.log('');

  if (await exists(TARGET_FILE)) {
    const info = await stat(TARGET_FILE);
    const bytes = await readFile(TARGET_FILE);
    const header = bytes.subarray(0, 4).toString('latin1');
    console.log('STATUS: BERKAS TARGET DITEMUKAN.');
    console.log(`  public/cards/targets.mind - ${info.size} byte - header "${header.replace(/[^\x20-\x7e]/g, '?')}"`);
    console.log('  Aplikasi akan memuat berkas ini lewat TARGET_FILE = "/cards/targets.mind".');
    console.log('');
    printPresentInstructions();
    if (missing.length > 0) {
      console.log('');
      console.log(`CATATAN: ${missing.length} gambar sumber hilang, tetapi berkas target sudah ada.`);
      console.log('Berkas target yang lama tetap dipakai; kompilasi ulang setelah gambar dibuat.');
      return 0;
    }
    console.log('');
    console.log('build-targets: selesai.');
    return 0;
  }

  console.error('==================================================================');
  console.error('STATUS: GAGAL - public/cards/targets.mind BELUM ADA.');
  console.error('==================================================================');
  console.error('');
  console.error('MindAR tidak punya compiler resmi untuk Node.js, jadi skrip ini tidak');
  console.error('mengompilasi apa pun dan sengaja keluar dengan kode non-nol. Berkas target');
  console.error('harus dibuat sekali dengan Image Target Compiler MindAR di browser.');
  console.error('');
  printMissingInstructions(missing);
  console.error('');
  console.error('Setelah berkas target ada, perintah ini akan keluar dengan kode 0.');
  return 1;
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main()
    .then((code) => { process.exitCode = code; })
    .catch((error) => {
      console.error('build-targets: galat tak terduga.');
      console.error(error);
      process.exitCode = 1;
    });
}

export { exists, checkSources, main };