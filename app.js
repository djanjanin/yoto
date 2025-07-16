/* ---------------------------------------------------------
   Main UI + MQTT logic for Yoto Matrix Preview
   --------------------------------------------------------- */

const API_ME = "https://api.prod.yoto.com/v1/consumers/me";
const PALETTE_COLORS = [
  "#000000",
  "#ffffff",
  "#ff0000",
  "#00ff00",
  "#0000ff",
  "#ffff00",
  "#ff00ff",
  "#00ffff",
  "#ffa500",
  "#800080",
  "#808080",
  "#964B00",
];

const GRID_SIZE = 16; // 16×16
const CELL_PX = 20; // canvas scaling
let currentColour = PALETTE_COLORS[2]; // default red
let pixelData = new Array(GRID_SIZE * GRID_SIZE).fill("#000000"); // hex strings
let deviceUuid = null;
let mqttClient = null;

/* ---------- DOM refs ---------- */
const loginBtn = document.getElementById("loginBtn");
const appDiv = document.getElementById("app");
const paletteDiv = document.getElementById("palette");
const gridCanvas = document.getElementById("grid");
const ctx = gridCanvas.getContext("2d");
const sendBtn = document.getElementById("sendBtn");
const statusP = document.getElementById("status");

/* ---------- Init Flow ---------- */
window.addEventListener("load", async () => {
  await auth.completeAuth(); // handle ?code=
  const token = await auth.getValidAccessToken();

  if (!token) {
    loginBtn.classList.remove("hidden");
    loginBtn.onclick = auth.startAuth;
    return;
  }

  status("Fetching device info...");
  try {
    const me = await fetch(API_ME, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.json());

    if (!me.players || me.players.length === 0) {
      status("No devices found on your account");
      return;
    }
    const player = me.players[0];
    deviceUuid = player.uuid;
    const mqttCreds = player.mqtt;

    await connectMqtt(mqttCreds);
    buildPalette();
    drawFullGrid();
    appDiv.classList.remove("hidden");
    status("Connected. Ready!");
  } catch (err) {
    console.error(err);
    status("Error fetching device info – see console");
  }
});

/* ---------- Palette + Drawing ---------- */
function buildPalette() {
  PALETTE_COLORS.forEach((hex) => {
    const swatch = document.createElement("div");
    swatch.className = "swatch";
    swatch.style.background = hex;
    if (hex === currentColour) swatch.classList.add("active");
    swatch.onclick = () => {
      currentColour = hex;
      document.querySelectorAll(".swatch").forEach((el) => el.classList.remove("active"));
      swatch.classList.add("active");
    };
    paletteDiv.appendChild(swatch);
  });
}

gridCanvas.addEventListener("click", (e) => {
  const rect = gridCanvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) / CELL_PX);
  const y = Math.floor((e.clientY - rect.top) / CELL_PX);

  if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) return;

  setPixel(x, y, currentColour);
  drawCell(x, y);
});

function setPixel(x, y, hex) {
  pixelData[y * GRID_SIZE + x] = hex;
}

function drawCell(x, y) {
  ctx.fillStyle = pixelData[y * GRID_SIZE + x];
  ctx.fillRect(x * CELL_PX, y * CELL_PX, CELL_PX, CELL_PX);
}

function drawFullGrid() {
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      drawCell(x, y);
    }
  }
}

/* ---------- Send Button ---------- */
sendBtn.addEventListener("click", () => {
  if (!mqttClient || !mqttClient.connected) {
    status("MQTT not connected");
    return;
  }
  const rgbFlat = pixelData.map(hexToRgbTriplet);
  const payload = JSON.stringify({ type: "matrix", pixels: rgbFlat });
  const topic = `device/${deviceUuid}/matrix/preview`;
  mqttClient.publish(topic, payload, { qos: 0 }, (err) => {
    if (err) {
      console.error(err);
      status("Publish error");
    } else {
      status("Preview sent!");
    }
  });
});

/* ---------- MQTT ---------- */
function connectMqtt(creds) {
  return new Promise((resolve, reject) => {
    status("Connecting to MQTT...");
    mqttClient = mqtt.connect("wss://mqtt.prod.yoto.com:443/mqtt", {
      username: creds.username,
      password: creds.password,
      clientId: creds.clientId,
      clean: true,
    });

    mqttClient.on("connect", () => {
      console.log("MQTT connected");
      resolve();
    });

    mqttClient.on("error", (err) => {
      console.error("MQTT error", err);
      status("MQTT error");
      reject(err);
    });
  });
}

/* ---------- Helpers ---------- */
function hexToRgbTriplet(hex) {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substr(0, 2), 16),
    parseInt(h.substr(2, 2), 16),
    parseInt(h.substr(4, 2), 16),
  ];
}

function status(msg) {
  statusP.textContent = msg;
}
