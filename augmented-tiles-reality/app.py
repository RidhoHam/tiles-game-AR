#!/usr/bin/env python3
"""
AR Piano Tiles — Web AR Mode (Default) & MIDI Converter
Run without arguments to launch the Web AR 3D player in your browser:
    python app.py

Or convert a MIDI file directly to tile JSON from terminal:
    python app.py convert demo.mid -o tiles.json --lanes 8
"""

import sys
import os
import struct
import json
import argparse
import webbrowser
from http.server import HTTPServer, SimpleHTTPRequestHandler
import socket

if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

def find_free_port(start_port=8000, max_attempts=50):
    for port in range(start_port, start_port + max_attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('127.0.0.1', port)) != 0:
                return port
    return start_port

class ARHTTPRequestHandler(SimpleHTTPRequestHandler):
    """Custom HTTP request handler with explicit MIME types and AR mode default routing."""
    extensions_map = SimpleHTTPRequestHandler.extensions_map.copy()
    extensions_map.update({
        '.mjs': 'application/javascript',
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.mp3': 'audio/mpeg',
        '.mid': 'audio/midi',
        '.midi': 'audio/midi',
        '.wasm': 'application/wasm',
    })

    def do_GET(self):
        # 2D mode disabled: default direct route to Web AR player
        if self.path in ('', '/', '/index.html'):
            self.send_response(302)
            self.send_header('Location', '/ar.html')
            self.end_headers()
            return
        return super().do_GET()

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

def run_server(port=8000, open_ar=True, open_browser=True):
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    actual_port = find_free_port(port)
    
    server_address = ('127.0.0.1', actual_port)
    httpd = HTTPServer(server_address, ARHTTPRequestHandler)
    
    url_ar = f"http://127.0.0.1:{actual_port}/ar.html"
    target_url = url_ar
    
    print("=" * 65)
    print(" 🎹 AR Piano Tiles — Web AR Mode (Default)")
    print("=" * 65)
    print(f" [*] Web AR 3D URL : {url_ar}")
    print(" [*] Mode          : 🥽 Web AR Mode (2D disabled)")
    if open_browser:
        print(f" [*] Opening browser: {target_url}")
    print(" [*] Press Ctrl+C in terminal to stop server.")
    print("=" * 65)
    
    if open_browser:
        webbrowser.open(target_url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[!] Server stopped.")
        httpd.server_close()

def parse_midi_to_tiles(midi_path, lane_count=8):
    """
    Pure-Python MIDI (SMF 0/1) to Tile Data Converter.
    No external pip dependencies required.
    """
    if not os.path.exists(midi_path):
        raise FileNotFoundError(f"File MIDI tidak ditemukan: {midi_path}")
        
    with open(midi_path, 'rb') as f:
        data = f.read()
        
    if len(data) < 14 or data[:4] != b'MThd':
        raise ValueError("File bukan format MIDI standar (header MThd tidak ditemukan)")
        
    _, fmt, ntracks, division = struct.unpack('>IHHH', data[4:14])
    ticks_per_beat = division if (division & 0x8000) == 0 else 480
    
    idx = 14
    tempo_us = 500000  # Default 120 BPM (500,000 us per quarter note)
    events = []
    
    for _ in range(ntracks):
        if idx >= len(data) or data[idx:idx+4] != b'MTrk':
            break
        track_len = struct.unpack('>I', data[idx+4:idx+8])[0]
        track_data = data[idx+8:idx+8+track_len]
        idx += 8 + track_len
        
        t_idx = 0
        cur_tick = 0
        running_status = 0
        
        while t_idx < len(track_data):
            delta = 0
            while True:
                b = track_data[t_idx]
                t_idx += 1
                delta = (delta << 7) | (b & 0x7F)
                if not (b & 0x80):
                    break
            cur_tick += delta
            
            if t_idx >= len(track_data):
                break
                
            status = track_data[t_idx]
            if status >= 0x80:
                running_status = status
                t_idx += 1
            else:
                status = running_status
                
            msg_type = status & 0xF0
            if msg_type in (0x80, 0x90):
                note = track_data[t_idx]
                vel = track_data[t_idx+1]
                t_idx += 2
                is_on = (msg_type == 0x90) and (vel > 0)
                events.append((cur_tick, 'on' if is_on else 'off', note, vel / 127.0))
            elif msg_type in (0xA0, 0xB0, 0xE0):
                t_idx += 2
            elif msg_type in (0xC0, 0xD0):
                t_idx += 1
            elif status == 0xFF:
                meta_type = track_data[t_idx]
                t_idx += 1
                m_len = 0
                while True:
                    b = track_data[t_idx]
                    t_idx += 1
                    m_len = (m_len << 7) | (b & 0x7F)
                    if not (b & 0x80):
                        break
                m_data = track_data[t_idx:t_idx+m_len]
                t_idx += m_len
                if meta_type == 0x51 and len(m_data) == 3:
                    tempo_us = (m_data[0] << 16) | (m_data[1] << 8) | m_data[2]
            elif status in (0xF0, 0xF7):
                s_len = 0
                while True:
                    b = track_data[t_idx]
                    t_idx += 1
                    s_len = (s_len << 7) | (b & 0x7F)
                    if not (b & 0x80):
                        break
                t_idx += s_len
                
    events.sort(key=lambda x: (x[0], 0 if x[1] == 'off' else 1))
    seconds_per_tick = (tempo_us / 1000000.0) / ticks_per_beat
    
    active_notes = {}
    completed_notes = []
    
    for tick, ev_type, note, vel in events:
        sec = tick * seconds_per_tick
        if ev_type == 'on':
            if note in active_notes:
                start_sec, old_vel = active_notes.pop(note)
                completed_notes.append({
                    'midi': note,
                    'time': round(start_sec, 3),
                    'duration': round(max(0.05, sec - start_sec), 3),
                    'velocity': round(old_vel, 2)
                })
            active_notes[note] = (sec, vel)
        elif ev_type == 'off':
            if note in active_notes:
                start_sec, old_vel = active_notes.pop(note)
                completed_notes.append({
                    'midi': note,
                    'time': round(start_sec, 3),
                    'duration': round(max(0.05, sec - start_sec), 3),
                    'velocity': round(old_vel, 2)
                })
                
    if not completed_notes:
        raise ValueError("Tidak ditemukan not musik dalam file MIDI ini.")
        
    p_min = min(n['midi'] for n in completed_notes)
    p_max = max(n['midi'] for n in completed_notes)
    
    note_names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
    def get_name(m):
        return f"{note_names[m % 12]}{m // 12 - 1}"
        
    for idx, n in enumerate(completed_notes, start=1):
        n['id'] = idx
        if p_max == p_min:
            lane = lane_count // 2
        else:
            t = (n['midi'] - p_min) / (p_max - p_min)
            lane = min(lane_count - 1, max(0, int(t * lane_count)))
        n['lane'] = lane
        n['name'] = get_name(n['midi'])
        
    completed_notes.sort(key=lambda x: (x['time'], x['lane']))
    
    bpm = round(60000000 / tempo_us)
    duration = max(n['time'] + n['duration'] for n in completed_notes)
    
    return {
        'title': os.path.splitext(os.path.basename(midi_path))[0],
        'bpm': bpm,
        'duration': round(duration, 2),
        'laneCount': lane_count,
        'pitchRange': [p_min, p_max],
        'totalTiles': len(completed_notes),
        'tiles': completed_notes
    }

def cli_convert(args):
    print(f"[*] Mengonversi '{args.input}' -> {args.lanes} lanes...")
    data = parse_midi_to_tiles(args.input, lane_count=args.lanes)
    
    out_file = args.output or f"{os.path.splitext(args.input)[0]}_tiles.json"
    with open(out_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)
        
    print("[OK] Berhasil dikonversi!")
    print(f"    - Judul      : {data['title']}")
    print(f"    - BPM        : {data['bpm']}")
    print(f"    - Durasi     : {data['duration']} detik")
    print(f"    - Total Tile : {data['totalTiles']} buah")
    print(f"    - Output JSON: {os.path.abspath(out_file)}")

def main():
    parser = argparse.ArgumentParser(description="AR Piano Tiles — MIDI to Tile Preview & Converter")
    subparsers = parser.add_subparsers(dest='subcommand')
    
    # Subcommand: convert
    convert_parser = subparsers.add_parser('convert', help='Konversi file MIDI ke tile JSON via terminal')
    convert_parser.add_argument('input', help='Path file MIDI (.mid / .midi)')
    convert_parser.add_argument('-o', '--output', help='Nama file output JSON (default: <input>_tiles.json)')
    convert_parser.add_argument('--lanes', type=int, default=8, help='Jumlah lanes (default: 8)')
    
    # Server arguments
    parser.add_argument('--port', type=int, default=8000, help='Port HTTP server (default: 8000)')
    parser.add_argument('--no-browser', action='store_true', help='Jalankan server tanpa otomatis membuka browser')
    
    args = parser.parse_args()
    
    if args.subcommand == 'convert':
        cli_convert(args)
    else:
        run_server(port=args.port, open_ar=True, open_browser=not args.no_browser)

if __name__ == '__main__':
    main()
