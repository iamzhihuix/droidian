#!/usr/bin/env node
/**
 * Droidian Relay Server
 *
 * WebSocket server that bridges remote clients to the Droid CLI via JSON-RPC.
 * Run this on your desktop Mac, then connect from mobile Obsidian.
 *
 * No external dependencies — uses only Node.js built-in modules.
 *
 * Usage:
 *   node relay_server.js [--port 8766] [--vault-path /path] [--cli-path /path/to/droid] [--token SECRET]
 */

'use strict';

const net = require('net');
const crypto = require('crypto');
const { spawn, execSync } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

// ── Configuration ─────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
function getArg(flag, def) {
  const i = argv.indexOf(flag);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : def;
}

const PORT = parseInt(getArg('--port', '8766'), 10);
const VAULT_PATH = getArg('--vault-path', null);
const CLI_PATH_ARG = getArg('--cli-path', null);
const TOKEN = getArg('--token', null);

// ── WebSocket constants ───────────────────────────────────────────────────────

const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const OP_TEXT = 0x1;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xA;

// ── Helpers ───────────────────────────────────────────────────────────────────

function findDroidCli() {
  if (CLI_PATH_ARG) return CLI_PATH_ARG;
  const candidates = [
    '/usr/local/bin/droid',
    '/usr/bin/droid',
    path.join(os.homedir(), '.local/bin/droid'),
    path.join(os.homedir(), '.factory/bin/droid'),
    '/opt/homebrew/bin/droid',
  ];
  for (const p of candidates) {
    try { fs.statSync(p); return p; } catch {}
  }
  try { return execSync('which droid', { encoding: 'utf8' }).trim(); } catch {}
  return 'droid';
}

function getShellEnv() {
  const env = { ...process.env };
  try {
    const shell = process.env.SHELL || '/bin/zsh';
    const out = execSync(`${shell} -lic 'echo "__PATH__"; echo "$PATH"'`, {
      encoding: 'utf8', timeout: 2000,
    });
    const p = out.split('__PATH__\n')[1]?.trim().split('\n')[0];
    if (p) env.PATH = p;
  } catch {}
  return env;
}

// ── WebSocket framing ─────────────────────────────────────────────────────────

function parseFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0F;
  const masked = (buf[1] >> 7) & 1;
  let len = buf[1] & 0x7F;
  let off = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2); off = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2)); off = 10;
  }
  let mask = null;
  if (masked) {
    if (buf.length < off + 4) return null;
    mask = buf.slice(off, off + 4); off += 4;
  }
  if (buf.length < off + len) return null;
  let payload = buf.slice(off, off + len);
  if (mask) payload = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
  return { opcode, payload, consumed: off + len };
}

function makeTextFrame(data) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  const len = payload.length;
  let hdr;
  if (len < 126) {
    hdr = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    hdr = Buffer.alloc(4); hdr[0] = 0x81; hdr[1] = 126; hdr.writeUInt16BE(len, 2);
  } else {
    hdr = Buffer.alloc(10); hdr[0] = 0x81; hdr[1] = 127; hdr.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([hdr, payload]);
}

function makePongFrame(payload) {
  return Buffer.concat([Buffer.from([0x8A, payload.length]), payload]);
}

function makeCloseFrame() {
  return Buffer.from([0x88, 0x00]);
}

// ── Droid session ─────────────────────────────────────────────────────────────

class DroidSession {
  constructor(send, onClose) {
    this.send = send;       // (str) => void
    this.onClose = onClose; // () => void
    this.proc = null;
    this.buf = '';
    this.dead = false;
  }

  start(cwd, args) {
    const droidPath = findDroidCli();
    const fullArgs = [
      'exec',
      '--input-format', 'stream-jsonrpc',
      '--output-format', 'stream-jsonrpc',
      ...args,
    ];

    let effectiveCwd = cwd;
    if (!effectiveCwd || !fs.existsSync(effectiveCwd)) {
      effectiveCwd = VAULT_PATH || os.homedir();
    }

    const env = getShellEnv();

    this.proc = spawn(droidPath, fullArgs, {
      cwd: effectiveCwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.proc.stdout.on('data', (data) => {
      this.buf += data.toString('utf8');
      const lines = this.buf.split('\n');
      this.buf = lines.pop() ?? '';
      for (const line of lines) {
        const t = line.trim();
        if (t && !this.dead) this.send(t);
      }
    });

    this.proc.stderr.on('data', (d) => {
      process.stderr.write('[droid] ' + d.toString());
    });

    this.proc.on('close', (code) => {
      if (!this.dead) {
        this.send(JSON.stringify({ type: 'relay_event', event: 'process_closed', code }));
      }
      this.proc = null;
    });

    this.proc.on('error', (err) => {
      if (!this.dead) {
        this.send(JSON.stringify({ type: 'relay_event', event: 'process_error', message: err.message }));
      }
    });

    this.send(JSON.stringify({ type: 'relay_event', event: 'started' }));
  }

  write(line) {
    if (this.proc?.stdin?.writable) {
      this.proc.stdin.write(line + '\n');
    }
  }

  stop() {
    this.dead = true;
    if (this.proc && !this.proc.killed) {
      this.proc.kill('SIGTERM');
      setTimeout(() => { if (this.proc && !this.proc.killed) this.proc.kill('SIGKILL'); }, 2000);
    }
    this.proc = null;
  }
}

// ── WebSocket upgrade ─────────────────────────────────────────────────────────

function doUpgrade(socket, httpRequest) {
  const lines = httpRequest.split('\r\n');
  const hdrs = {};
  for (const line of lines.slice(1)) {
    const i = line.indexOf(': ');
    if (i !== -1) hdrs[line.slice(0, i).toLowerCase()] = line.slice(i + 2);
  }

  const key = hdrs['sec-websocket-key'];
  if (!key) { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return false; }

  if (TOKEN) {
    const reqLine = lines[0] || '';
    const urlPart = reqLine.split(' ')[1] || '/';
    let tok = '';
    try { tok = new URL('ws://x' + urlPart).searchParams.get('token') || ''; } catch {}
    if (tok !== TOKEN) { socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n'); return false; }
  }

  const accept = crypto.createHash('sha1').update(key + WS_MAGIC).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n` +
    '\r\n'
  );
  return true;
}

// ── Client handler ────────────────────────────────────────────────────────────

function handleClient(socket) {
  const addr = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log(`[+] ${addr}`);

  let upgraded = false;
  let httpBuf = Buffer.alloc(0);
  let wsBuf = Buffer.alloc(0);
  let session = null;

  function sendStr(str) {
    if (!socket.writable) return;
    try { socket.write(makeTextFrame(str)); } catch {}
  }

  socket.on('data', (chunk) => {
    if (!upgraded) {
      httpBuf = Buffer.concat([httpBuf, chunk]);
      const str = httpBuf.toString('binary');
      if (!str.includes('\r\n\r\n')) return;
      if (!doUpgrade(socket, httpBuf.toString('utf8'))) return;
      upgraded = true;
      session = new DroidSession(sendStr, () => socket.destroy());
      httpBuf = Buffer.alloc(0);
      return;
    }

    wsBuf = Buffer.concat([wsBuf, chunk]);
    while (wsBuf.length > 0) {
      const frame = parseFrame(wsBuf);
      if (!frame) break;
      wsBuf = wsBuf.slice(frame.consumed);

      if (frame.opcode === OP_CLOSE) {
        try { socket.write(makeCloseFrame()); } catch {}
        socket.end(); return;
      }
      if (frame.opcode === OP_PING) {
        try { socket.write(makePongFrame(frame.payload)); } catch {}
        continue;
      }
      if (frame.opcode !== OP_TEXT) continue;

      const msg = frame.payload.toString('utf8');
      try {
        const parsed = JSON.parse(msg);
        if (parsed.type === 'relay_init') {
          const { cwd, model, autoLevel, autoArgs = [] } = parsed;
          const args = [];
          if (autoLevel && autoLevel !== 'readonly') args.push('--auto', autoLevel);
          if (model) args.push('--model', model);
          args.push(...autoArgs);
          session.start(cwd, args);
          continue;
        }
        if (parsed.type === 'relay_ping') {
          sendStr(JSON.stringify({ type: 'relay_pong' }));
          continue;
        }
      } catch {}

      // Pass-through JSON-RPC to droid
      session.write(msg);
    }
  });

  socket.on('close', () => {
    console.log(`[-] ${addr}`);
    session?.stop();
  });

  socket.on('error', (err) => {
    console.error(`[!] ${addr}: ${err.message}`);
    session?.stop();
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

const server = net.createServer(handleClient);

server.listen(PORT, '0.0.0.0', () => {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const list of Object.values(ifaces)) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal) ips.push(a.address);
    }
  }
  console.log('Droidian Relay Server');
  console.log('='.repeat(40));
  console.log(`Listening on 0.0.0.0:${PORT}`);
  if (ips.length) {
    console.log('LAN addresses:');
    for (const ip of ips) console.log(`  ws://${ip}:${PORT}`);
  }
  if (TOKEN) console.log(`Auth token required (append ?token=... to URL)`);
  console.log();
});

server.on('error', (err) => {
  console.error('Server error:', err.message);
  process.exit(1);
});

process.on('SIGTERM', () => { server.close(); process.exit(0); });
process.on('SIGINT', () => { server.close(); process.exit(0); });
