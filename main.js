process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen } = require('electron');
const { execSync } = require('child_process');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'config.json');
let CONFIG = { baseUrl: '', authToken: '', modelName: '' };
try {
  CONFIG = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
  console.error('读取 config.json 失败，使用默认空配置');
}

const BASE_URL = CONFIG.baseUrl;
const ANTHROPIC_AUTH_TOKEN = CONFIG.authToken;
const MODEL_NAME = CONFIG.modelName;

let win;
let tray;
let moveTimer = null;
let claudeTimer = null;
let targetX = 0;
let targetY = 0;
let dogX = 0;
let dogY = 0;
let moveDir = 1;
let isMoving = false;
let claudeStatus = 'offline';
let manualDragPause = 0;
const MOVE_SPEED = 1.5;

function createWindow() {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  dogX = screenW - 240;
  dogY = screenH - 300;
  win = new BrowserWindow({
    width: 200,
    height: 260,
    x: Math.round(dogX),
    y: Math.round(dogY),
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    type: 'panel',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  win.loadFile('index.html');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  win.webContents.on('did-finish-load', () => {
    startMovementAI();
    startClaudeMonitor();
  });

  win.on('closed', () => {
    clearInterval(moveTimer);
    clearInterval(claudeTimer);
    win = null;
  });
}

function createTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  const contextMenu = Menu.buildFromTemplate([
    { label: '显示宠物', click: () => { if (win) { win.show(); } } },
    { label: '隐藏宠物', click: () => { if (win) { win.hide(); } } },
    { type: 'separator' },
    { label: '退出程序', click: () => { app.quit(); } }
  ]);
  tray.setToolTip('萨摩耶宠物');
  tray.setContextMenu(contextMenu);
}

function getClaudeStatus() {
  try {
    const out = execSync("ps aux | grep -i '[c]laude' | grep -v Electron | grep -v grep", { encoding: 'utf8', timeout: 2000 }).trim();
    if (!out) { return 'offline'; }
    const lines = out.split('\n');
    let maxCpu = 0;
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const cpu = parseFloat(parts[2]);
      if (cpu > maxCpu) { maxCpu = cpu; }
    }
    if (maxCpu > 30) { return 'thinking'; }
    if (maxCpu > 5) { return 'working'; }
    return 'idle';
  } catch {
    return 'offline';
  }
}

function getMouseAvoidRect() {
  try {
    const mp = screen.getCursorScreenPoint();
    return { x: mp.x - 200, y: mp.y - 100, w: 400, h: 200 };
  } catch {
    return null;
  }
}

function isInsideRect(x, y, rect) {
  return x > rect.x - 50 && x < rect.x + rect.w + 50 && y > rect.y - 50 && y < rect.y + rect.h + 50;
}

function pickNewTarget() {
  const display = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = display.workAreaSize;
  const margin = 60;
  const mouseRect = getMouseAvoidRect();

  for (let attempt = 0; attempt < 30; attempt++) {
    const tx = margin + Math.random() * (sw - margin * 2);
    const ty = margin + Math.random() * (sh - margin * 2);
    if (mouseRect && isInsideRect(tx, ty, mouseRect)) { continue; }
    return { x: tx, y: ty };
  }
  return { x: margin + Math.random() * (sw - margin * 2), y: margin + Math.random() * (sh - margin * 2) };
}

let petState = 'idle';
let idleTicks = 0;
const IDLE_TICKS_MIN = 150;
const IDLE_TICKS_MAX = 450;

function startMovementAI() {
  moveTimer = setInterval(() => {
    if (!win || !win.isVisible()) { return; }
    if (Date.now() - manualDragPause < 3000) {
      idleTicks = 0;
      if (isMoving) {
        isMoving = false;
        try { win.webContents.send('move-state', { moving: false, dir: moveDir }); } catch (e) {}
      }
      return;
    }

    if (petState === 'idle') {
      idleTicks++;
      if (idleTicks > IDLE_TICKS_MIN + Math.random() * (IDLE_TICKS_MAX - IDLE_TICKS_MIN)) {
        petState = 'walking';
        const t = pickNewTarget();
        targetX = t.x; targetY = t.y;
        idleTicks = 0;
        if (!isMoving) {
          isMoving = true;
          try { win.webContents.send('move-state', { moving: true, dir: moveDir }); } catch (e) {}
        }
      }
      return;
    }

    const dx = targetX - dogX;
    const dy = targetY - dogY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 6) {
      petState = 'idle';
      idleTicks = 0;
      if (isMoving) {
        isMoving = false;
        try { win.webContents.send('move-state', { moving: false, dir: moveDir }); } catch (e) {}
      }
      return;
    }

    const nx = dx / dist;
    const ny = dy / dist;
    if (Math.abs(dx) > 3) { moveDir = dx > 0 ? 1 : -1; }

    dogX += nx * MOVE_SPEED;
    dogY += ny * MOVE_SPEED;

    const sb = screen.getPrimaryDisplay().workAreaSize;
    dogX = Math.max(0, Math.min(sb.width - 200, dogX));
    dogY = Math.max(0, Math.min(sb.height - 260, dogY));

    try { win.setPosition(Math.round(dogX), Math.round(dogY)); } catch (e) {}
  }, 33);
}

function startClaudeMonitor() {
  claudeTimer = setInterval(() => {
    if (!win || win.isDestroyed()) { return; }
    const status = getClaudeStatus();
    if (status !== claudeStatus) {
      claudeStatus = status;
      try { win.webContents.send('claude-status', { status }); } catch (e) {}
    }
  }, 2000);
}

ipcMain.on('move-window', (event, { dx, dy, start }) => {
  if (!win) return;
  manualDragPause = Date.now();
  if (start) {
    petState = 'idle';
    idleTicks = 0;
    try { win.webContents.send('move-state', { moving: false, dir: moveDir }); } catch (e) {}
    return;
  }
  dogX += dx;
  dogY += dy;
  const sb = screen.getPrimaryDisplay().workAreaSize;
  dogX = Math.max(0, Math.min(sb.width - 200, dogX));
  dogY = Math.max(0, Math.min(sb.height - 260, dogY));
  try { win.setPosition(Math.round(dogX), Math.round(dogY)); } catch (e) {}
  isMoving = false;
});

ipcMain.handle('chat', async (event, question) => {
  return new Promise((resolve) => {
    try {
      const apiUrl = new URL(`${BASE_URL}/v1/messages`);
      const body = JSON.stringify({
        model: MODEL_NAME,
        max_tokens: 300,
        system: '你是桌面宠物——一只可爱的白色萨摩耶小狗，称呼用户为"主人"。用狗狗口吻回复主人，活泼俏皮，2-3句话以内。多用汪汪～、嘿嘿～等语气词。不要说你做不到什么，直接以狗狗身份互动。你不知道的事情就撒娇卖萌糊弄过去。',
        messages: [{ role: 'user', content: question }]
      });
      const opts = {
        hostname: apiUrl.hostname, port: apiUrl.port || 443,
        path: apiUrl.pathname, method: 'POST',
        rejectUnauthorized: false,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_AUTH_TOKEN,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body)
        }
      };
      const transport = apiUrl.protocol === 'https:' ? https : http;
      const req = transport.request(opts, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const text = json.content?.[0]?.text;
            resolve(text || '汪汪，它好像走神了～');
          } catch (e) {
            resolve('汪汪，回复解析失败～');
          }
        });
      });
      req.on('error', (e) => resolve('汪汪，' + e.message + '～'));
      req.setTimeout(30000, () => { req.destroy(); resolve('汪汪，请求超时了～'); });
      req.write(body);
      req.end();
    } catch (e) {
      resolve('汪汪，' + (e.message || '出错了') + '～');
    }
  });
});

ipcMain.handle('get-claude-status', () => {
  return { status: claudeStatus };
});

app.whenReady().then(() => {
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  clearInterval(moveTimer);
  clearInterval(claudeTimer);
  if (tray) { tray.destroy(); }
});
