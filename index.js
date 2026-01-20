const https = require("https");
const http = require("http");
const notifier = require("node-notifier");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const MAIN_WEBSITE = "https://lumineproxy.org/";
const REGIONS = {
  AS: "http://as.lumineproxy.org:1456/healthz",
  NA: "http://na.lumineproxy.org:1456/healthz",
  EU: "http://eu.lumineproxy.org:1456/healthz",
};
const INTERVAL = 10000;

let statusData = {
  main: { online: false, responseTime: 0, lastCheck: null },
  regions: {
    AS: { online: false, responseTime: 0, uptime: 0, checks: 0, successes: 0 },
    NA: { online: false, responseTime: 0, uptime: 0, checks: 0, successes: 0 },
    EU: { online: false, responseTime: 0, uptime: 0, checks: 0, successes: 0 }
  },
  logs: []
};

function addLog(message, type = 'info') {
  const log = {
    id: Date.now(),
    time: new Date().toLocaleTimeString(),
    message,
    type
  };
  statusData.logs.unshift(log);
  if (statusData.logs.length > 10) statusData.logs.pop();
}

function ping(url, callback) {
  const start = Date.now();
  const lib = url.startsWith("https") ? https : http;
  const req = lib.get(url, (res) => {
    const responseTime = Date.now() - start;
    callback(res.statusCode >= 200 && res.statusCode < 300, responseTime);
  });
  
  req.on("error", () => callback(false, 0));
  req.setTimeout(5000, () => {
    req.destroy();
    callback(false, 0);
  });
}

function checkServers() {
  ping(MAIN_WEBSITE, (online, responseTime) => {
    if (online !== statusData.main.online && statusData.main.lastCheck !== null) {
      const state = online ? "ONLINE" : "OFFLINE";
      addLog(`Main system transitioned to ${state}`, online ? 'success' : 'error');
      if (online) {
        notifier.notify({ title: "Lumine Proxy", message: "Main site is back online!" });
      }
    }
    
    statusData.main = { online, responseTime, lastCheck: Date.now() };

    let completed = 0;
    const regionEntries = Object.entries(REGIONS);

    regionEntries.forEach(([region, url]) => {
      ping(url, (onlineRegion, rt) => {
        const prevStatus = statusData.regions[region].online;
        if (prevStatus !== onlineRegion && statusData.regions[region].checks > 0) {
            addLog(`${region} node is now ${onlineRegion ? 'Operational' : 'Down'}`, onlineRegion ? 'success' : 'error');
        }

        statusData.regions[region].online = onlineRegion;
        statusData.regions[region].responseTime = rt;
        statusData.regions[region].checks++;
        if (onlineRegion) statusData.regions[region].successes++;
        statusData.regions[region].uptime = 
          ((statusData.regions[region].successes / statusData.regions[region].checks) * 100).toFixed(1);
        
        completed++;
        if (completed === regionEntries.length) {
          io.emit("statusUpdate", statusData);
        }
      });
    });
  });
}

setInterval(checkServers, INTERVAL);
checkServers();

app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Lumine Monitor | Pro</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --accent: #38bdf8;
      --success: #10b981;
      --error: #ef4444;
      --warning: #f59e0b;
      --text-main: #f8fafc;
      --text-dim: #94a3b8;
      --border: rgba(255,255,255,0.08);
    }

    * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Inter', system-ui, sans-serif; }
    
    body {
      background-color: var(--bg);
      color: var(--text-main);
      min-height: 100vh;
      display: flex;
      justify-content: center;
      padding: 40px 20px;
    }

    .dashboard {
      width: 100%;
      max-width: 1100px;
      display: grid;
      grid-template-columns: 1fr 320px;
      gap: 24px;
    }

    /* Header Styling */
    .header-area {
      grid-column: 1 / -1;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }

    .brand { display: flex; align-items: center; gap: 12px; }
    .brand-icon { 
        width: 40px; height: 40px; background: var(--accent); 
        border-radius: 10px; display: flex; align-items: center; justify-content: center;
        box-shadow: 0 0 20px rgba(56, 189, 248, 0.3);
    }

    /* Box/Card styling */
    .box {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      position: relative;
      overflow: hidden;
    }

    /* Main Status Box */
    .main-status-box {
      grid-column: 1 / 2;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .status-large {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .badge {
      padding: 6px 12px;
      border-radius: 100px;
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .badge-success { background: rgba(16, 185, 129, 0.1); color: var(--success); border: 1px solid rgba(16, 185, 129, 0.2); }
    .badge-error { background: rgba(239, 68, 68, 0.1); color: var(--error); border: 1px solid rgba(239, 68, 68, 0.2); }

    /* Grid for Mini Stats */
    .metrics-row {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
    }

    .metric-card {
      background: rgba(0,0,0,0.2);
      padding: 16px;
      border-radius: 12px;
      border: 1px solid var(--border);
    }

    .metric-label { font-size: 0.75rem; color: var(--text-dim); margin-bottom: 4px; }
    .metric-value { font-size: 1.25rem; font-weight: 600; }

    /* Nodes Grid */
    .nodes-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 16px;
      margin-top: 24px;
      grid-column: 1 / 2;
    }

    .node-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      transition: transform 0.2s;
    }

    .node-card:hover { transform: translateY(-2px); border-color: var(--accent); }

    .node-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }

    .node-name { font-weight: 600; font-size: 0.95rem; display: flex; align-items: center; gap: 8px; }
    
    .latency-bar-bg {
        height: 4px; background: rgba(255,255,255,0.05); border-radius: 2px; margin: 10px 0;
    }
    .latency-bar-fill {
        height: 100%; border-radius: 2px; transition: width 0.5s, background 0.5s;
    }

    /* Sidebar / Logs */
    .sidebar {
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    .log-container {
      flex-grow: 1;
      font-size: 0.85rem;
    }

    .log-entry {
      padding: 10px 0;
      border-bottom: 1px solid var(--border);
      display: flex;
      gap: 10px;
    }
    .log-time { color: var(--text-dim); min-width: 60px; }
    .log-msg { color: var(--text-main); }

    /* Countdown Circle */
    .timer-container {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 0.8rem;
      color: var(--text-dim);
    }

    .refresh-btn {
        background: var(--accent);
        color: var(--bg);
        border: none;
        padding: 10px 20px;
        border-radius: 8px;
        font-weight: 600;
        cursor: pointer;
        transition: opacity 0.2s;
    }
    .refresh-btn:hover { opacity: 0.9; }

    /* Custom SVGs replacement for emojis */
    .icon { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

    @media (max-width: 900px) {
      .dashboard { grid-template-columns: 1fr; }
      .sidebar { order: 2; }
    }
  </style>
</head>
<body>
  <div class="dashboard">
    <div class="header-area">
      <div class="brand">
        <div class="brand-icon">
            <svg class="icon" style="stroke: white" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path></svg>
        </div>
        <div>
            <h2 style="font-size: 1.25rem;">Lumine Network</h2>
            <p style="font-size: 0.75rem; color: var(--text-dim);">System Monitoring Dashboard</p>
        </div>
      </div>
      <div class="timer-container">
        <span>Refresh in <strong id="countdown">10</strong>s</span>
        <button class="refresh-btn" onclick="forceCheck()">Sync Now</button>
      </div>
    </div>

    <div class="main-status-box box">
      <div class="status-large">
        <div>
            <h3 style="color: var(--text-dim); font-size: 0.8rem; text-transform: uppercase; margin-bottom: 4px;">Global Infrastructure</h3>
            <h1 id="mainStatusText">Initializing...</h1>
        </div>
        <div id="mainBadge" class="badge">Checking</div>
      </div>

      <div class="metrics-row">
        <div class="metric-card">
            <div class="metric-label">Average Latency</div>
            <div class="metric-value" id="avgLatency">--</div>
        </div>
        <div class="metric-card">
            <div class="metric-label">Active Nodes</div>
            <div class="metric-value" id="activeNodes">0 / 3</div>
        </div>
        <div class="metric-card">
            <div class="metric-label">Network Uptime</div>
            <div class="metric-value" id="totalUptime">--</div>
        </div>
      </div>
    </div>

    <div class="sidebar box">
        <h3 style="font-size: 0.9rem; margin-bottom: 16px; display: flex; align-items: center; gap: 8px;">
            <svg class="icon" viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path></svg>
            Activity Log
        </h3>
        <div id="logContainer" class="log-container">
            <p style="color: var(--text-dim)">Awaiting first heartbeat...</p>
        </div>
    </div>

    <div class="nodes-grid" id="nodesGrid">
      </div>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    let countdown = ${INTERVAL / 1000};

    // Icons Mapping (SVG Strings)
    const Icons = {
        globe: '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>',
        zap: '<svg class="icon" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>',
        shield: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>'
    };

    function updateCountdown() {
        const el = document.getElementById('countdown');
        if (countdown <= 0) countdown = ${INTERVAL / 1000};
        el.textContent = countdown;
        countdown--;
    }
    setInterval(updateCountdown, 1000);

    socket.on("statusUpdate", data => {
      // Update Main Header
      const statusText = document.getElementById("mainStatusText");
      const mainBadge = document.getElementById("mainBadge");
      
      statusText.textContent = data.main.online ? "Systems Operational" : "System Disruption";
      mainBadge.className = 'badge ' + (data.main.online ? 'badge-success' : 'badge-error');
      mainBadge.textContent = data.main.online ? 'Online' : 'Offline';

      // Calculate Metrics
      const regions = Object.values(data.regions);
      const onlineCount = regions.filter(r => r.online).length;
      const avgLat = Math.round(regions.reduce((acc, r) => acc + r.responseTime, 0) / regions.length);
      const avgUp = (regions.reduce((acc, r) => acc + parseFloat(r.uptime), 0) / regions.length).toFixed(1);

      document.getElementById("activeNodes").textContent = \`\${onlineCount} / \${regions.length}\`;
      document.getElementById("avgLatency").textContent = \`\${avgLat}ms\`;
      document.getElementById("totalUptime").textContent = \`\${avgUp}%\`;

      // Update Nodes Grid
      const nodesGrid = document.getElementById("nodesGrid");
      nodesGrid.innerHTML = '';
      
      for (const [key, node] of Object.entries(data.regions)) {
        const latPercent = Math.min((node.responseTime / 1000) * 100, 100);
        const latColor = node.responseTime < 200 ? 'var(--success)' : (node.responseTime < 500 ? 'var(--warning)' : 'var(--error)');
        
        const card = document.createElement('div');
        card.className = 'node-card';
        card.innerHTML = \`
          <div class="node-header">
            <div class="node-name">\${Icons.globe} Node \${key}</div>
            <div class="badge \${node.online ? 'badge-success' : 'badge-error'}" style="font-size: 0.6rem">\${node.online ? 'Active' : 'Down'}</div>
          </div>
          <div style="font-size: 1.1rem; font-weight: 600; margin-bottom: 4px;">\${node.responseTime}ms</div>
          <div class="latency-bar-bg">
            <div class="latency-bar-fill" style="width: \${node.online ? latPercent : 0}%; background: \${latColor}"></div>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-dim); margin-top: 12px;">
            <span>Uptime</span>
            <span style="color: var(--text-main)">\${node.uptime}%</span>
          </div>
        \`;
        nodesGrid.appendChild(card);
      }

      // Update Logs
      const logContainer = document.getElementById("logContainer");
      logContainer.innerHTML = data.logs.map(log => \`
        <div class="log-entry">
            <span class="log-time">\${log.time}</span>
            <span class="log-msg" style="color: \${log.type === 'error' ? 'var(--error)' : (log.type === 'success' ? 'var(--success)' : 'var(--text-main)')}">
                \${log.message}
            </span>
        </div>
      \`).join('');

      countdown = ${INTERVAL / 1000};
    });

    function forceCheck() {
      socket.emit("forceCheck");
      countdown = ${INTERVAL / 1000};
    }
  </script>
</body>
</html>
  `);
});

io.on("connection", (socket) => {
  socket.emit("statusUpdate", statusData);
  socket.on("forceCheck", () => checkServers());
});

server.listen(3000, () => {
  console.log("🚀 Monitor running at http://localhost:3000");
});
