/* ---------------------------------------------------------
   Main UI + MQTT logic for Yoto Matrix Preview
   --------------------------------------------------------- */

const API_ME = "https://api.yotoplay.com/device-v2/devices/mine";
const MQTT_URL = "wss://aqrphjqbp3u2z-ats.iot.eu-west-2.amazonaws.com";
const KEEPALIVE = 300;
const IMGBB_URL = "https://api.imgbb.com/1/upload";
const IMGBB_KEY = "5c0ffd4498be915245e46f95256cdc78";

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

/* ---------- Debug helper ---------- */
const DEBUG = true;
function dbg(...args) {
  if (DEBUG) console.log(...args);
}
let currentRGB = PALETTE_COLORS[2]; // default red
let currentAlpha = 255; // 0-255
let pixelData = new Array(GRID_SIZE * GRID_SIZE).fill("#000000FF"); // 8-digit hex #RRGGBBAA
let deviceId = null;
let mqttClient = null;
let isDragging = false;

/* ---------- DOM refs ---------- */
const loginBtn = document.getElementById("loginBtn");
const appDiv = document.getElementById("app");
const deviceSelect = document.getElementById("deviceSelect");
const connectBtn = document.getElementById("connectBtn");
const paletteDiv = document.getElementById("palette");
const alphaSlider = document.getElementById("alphaSlider");
const alphaValue = document.getElementById("alphaValue");
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
    const res = await fetch(API_ME, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const { devices } = await res.json();
    dbg("Devices array", devices);

    if (!devices || devices.length === 0) {
      status("No devices found on your account");
      return;
    }

    // Populate device select
    devices.forEach((d) => {
      const option = document.createElement("option");
      option.value = d.deviceId;
      option.textContent = `${d.name} (${d.online ? "Online" : "Offline"})`;
      deviceSelect.appendChild(option);
    });

    // Show select and connect button
    deviceSelect.classList.remove("hidden");
    connectBtn.classList.remove("hidden");
    appDiv.classList.remove("hidden");

    connectBtn.onclick = async () => {
      const selectedId = deviceSelect.value;
      if (!selectedId) {
        status("Select a device");
        return;
      }

      const selectedDevice = devices.find(d => d.deviceId === selectedId);
      if (!selectedDevice.online) {
        status("Selected device is offline");
        return;
      }

      deviceId = selectedId;
      dbg("Selected device", selectedDevice);

      await connectMqtt(token, deviceId);

      // Hide select/connect, show editor
      deviceSelect.classList.add("hidden");
      connectBtn.classList.add("hidden");
      paletteDiv.style.display = "flex";
      alphaSlider.parentElement.style.display = "flex";
      gridCanvas.style.display = "block";
      sendBtn.style.display = "block";

      buildPalette();
      initAlphaSlider();
      drawFullGrid();
      status("Connected. Ready!");
    };
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
    if (hex === currentRGB) swatch.classList.add("active");
    swatch.onclick = () => {
      currentRGB = hex;
      document.querySelectorAll(".swatch").forEach((el) => el.classList.remove("active"));
      swatch.classList.add("active");
    };
    paletteDiv.appendChild(swatch);
  });
}

function initAlphaSlider() {
  alphaSlider.value = currentAlpha;
  alphaValue.textContent = currentAlpha;
  alphaSlider.addEventListener("input", (e) => {
    currentAlpha = parseInt(e.target.value);
    alphaValue.textContent = currentAlpha;
  });
}

function getCellCoords(e) {
  const rect = gridCanvas.getBoundingClientRect();
  const clientX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
  const clientY = e.clientY || (e.touches && e.touches[0].clientY) || 0;
  const x = Math.floor((clientX - rect.left) / CELL_PX);
  const y = Math.floor((clientY - rect.top) / CELL_PX);
  return { x, y };
}

function handlePaint(e) {
  const { x, y } = getCellCoords(e);
  if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) return;
  setPixel(x, y);
  drawCell(x, y);
}

// Mouse events
gridCanvas.addEventListener("mousedown", (e) => {
  isDragging = true;
  handlePaint(e);
  dbg("Drag start (mouse)");
});

gridCanvas.addEventListener("mousemove", (e) => {
  if (isDragging) handlePaint(e);
});

gridCanvas.addEventListener("mouseup", () => {
  isDragging = false;
  dbg("Drag end (mouse)");
});

gridCanvas.addEventListener("mouseleave", () => {
  isDragging = false;
});

// Touch events
gridCanvas.addEventListener("touchstart", (e) => {
  e.preventDefault();
  isDragging = true;
  handlePaint(e);
  dbg("Drag start (touch)");
});

gridCanvas.addEventListener("touchmove", (e) => {
  e.preventDefault();
  if (isDragging) handlePaint(e);
});

gridCanvas.addEventListener("touchend", (e) => {
  e.preventDefault();
  isDragging = false;
  dbg("Drag end (touch)");
});

function setPixel(x, y) {
  const alphaHex = currentAlpha.toString(16).padStart(2, '0').toUpperCase();
  pixelData[y * GRID_SIZE + x] = currentRGB + alphaHex;
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
sendBtn.addEventListener("click", async () => {
  if (!mqttClient || !mqttClient.connected) {
    status("MQTT not connected");
    return;
  }

  status("Uploading icon...");
  try {
    const smallCanvas = document.createElement("canvas");
    smallCanvas.width = GRID_SIZE;
    smallCanvas.height = GRID_SIZE;
    const smallCtx = smallCanvas.getContext("2d");

    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        smallCtx.fillStyle = pixelData[y * GRID_SIZE + x];
        smallCtx.fillRect(x, y, 1, 1);
      }
    }

    const base64 = smallCanvas.toDataURL("image/png").split(",")[1];

    const formData = new FormData();
    formData.append("key", IMGBB_KEY);
    formData.append("image", base64);

    const res = await fetch(IMGBB_URL, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) throw new Error("Upload failed");

    const { data } = await res.json();
    const uri = data.display_url;
    dbg("Uploaded URI", uri);

    const payload = JSON.stringify({
      uri,
      timeout: 30,
      animated: 0,
    });
    const topic = `device/${deviceId}/command/display/preview`;

    mqttClient.publish(topic, payload, { qos: 0 }, (err) => {
      if (err) {
        console.error(err);
        status("Publish error");
      } else {
        status("Preview sent!");
      }
    });
  } catch (err) {
    console.error(err);
    status("Upload error – see console");
  }
});

/* ---------- MQTT ---------- */
function connectMqtt(accessToken, deviceId) {
  return new Promise((resolve, reject) => {
    status("Connecting to MQTT...");
    const clientId = `DASH${deviceId}`;

    mqttClient = mqtt.connect(MQTT_URL, {
      keepalive: KEEPALIVE,
      port: 443,
      protocol: "wss",
      username: `${deviceId}?x-amz-customauthorizer-name=PublicJWTAuthorizer`,
      password: accessToken,
      reconnectPeriod: 0,
      clientId,
      ALPNProtocols: ["x-amzn-mqtt-ca"],
    });

    mqttClient.on("connect", () => {
      dbg("MQTT connected");
      const topics = [
        `device/${deviceId}/events`,
        `device/${deviceId}/status`,
        `device/${deviceId}/response`,
      ];
      mqttClient.subscribe(topics, { qos: 0 }, (err) => {
        if (err) {
          dbg("Subscribe error", err);
        } else {
          dbg("Subscribed to topics", topics);
        }
      });
      resolve();
    });

    mqttClient.on("message", (topic, message) => {
      const [base, device, messageType] = topic.split("/");

      if (device === deviceId) {
        const payload = JSON.parse(message.toString());
        dbg(`Received ${messageType}`, payload);
      }
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
