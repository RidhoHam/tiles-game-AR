import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import qrcode from 'qrcode-terminal';

const CANDIDATE_PATHS = [
  'C:\\Users\\MRHAM\\Desktop\\ngrok.exe',
  join(process.env.USERPROFILE || '', 'Desktop', 'ngrok.exe'),
  process.env.NGROK_PATH,
  'ngrok'
].filter(Boolean);

function findNgrok() {
  for (const p of CANDIDATE_PATHS) {
    if (existsSync(p)) return p;
  }
  return 'ngrok';
}

const ngrokPath = findNgrok();
const PORT = process.env.PORT || 5173;

async function isPortOpen(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function getNgrokUrl() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch('http://127.0.0.1:4040/api/tunnels', { signal: AbortSignal.timeout(1500) });
      if (res.ok) {
        const data = await res.json();
        const tunnel = data?.tunnels?.find(t => t.proto === 'https') || data?.tunnels?.[0];
        if (tunnel?.public_url) return tunnel.public_url;
      }
    } catch {
      // wait and retry
    }
    await new Promise(r => setTimeout(r, 600));
  }
  return null;
}

async function main() {
  console.log('\n🔍 Menyiapkan tunnel AR untuk perangkat HP...');

  let viteProc = null;
  const isViteRunning = await isPortOpen(PORT);
  if (!isViteRunning) {
    console.log(`🚀 Memulai Vite dev server pada port ${PORT}...`);
    viteProc = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', '--port', String(PORT)], {
      stdio: 'inherit',
      shell: true
    });
    for (let i = 0; i < 20; i++) {
      if (await isPortOpen(PORT)) break;
      await new Promise(r => setTimeout(r, 500));
    }
  } else {
    console.log(`✓ Server lokal terdeteksi aktif pada port ${PORT}.`);
  }

  console.log(`🌐 Menjalankan ngrok (${ngrokPath}) -> http://localhost:${PORT}...`);
  const ngrokProc = spawn(ngrokPath, ['http', String(PORT)], {
    stdio: 'ignore'
  });

  const cleanup = () => {
    console.log('\n🛑 Menghentikan tunnel...');
    try { ngrokProc.kill(); } catch {}
    try { viteProc?.kill(); } catch {}
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('exit', () => {
    try { ngrokProc.kill(); } catch {}
    try { viteProc?.kill(); } catch {}
  });

  const publicUrl = await getNgrokUrl();
  if (!publicUrl) {
    console.error('❌ Gagal mendapatkan URL publik dari ngrok. Pastikan ngrok terpasang dan authtoken sudah disetel.');
    cleanup();
    return;
  }

  console.log('\n' + '='.repeat(54));
  console.log('🎮 PERANG BENTENG PASIR AR - MOBILE READY');
  console.log('='.repeat(54));
  console.log(`🔗 Link HTTPS : \x1b[36m${publicUrl}\x1b[0m`);
  console.log('\n📲 Scan QR Code berikut dengan kamera / scanner HP:\n');
  
  qrcode.generate(publicUrl, { small: true });

  console.log('='.repeat(54));
  console.log('💡 Petunjuk:');
  console.log('1. Arahkan kamera HP ke QR code di atas untuk membuka game.');
  console.log('2. Izinkan akses kamera browser saat diminta.');
  console.log('3. Tekan Ctrl + C di terminal ini untuk berhenti.');
  console.log('='.repeat(54) + '\n');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
