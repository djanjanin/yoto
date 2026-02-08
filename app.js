/* ---------------------------------------------------------
   Main UI + MQTT logic for Yoto Matrix Preview
   --------------------------------------------------------- */

const API_ME = "https://api.yotoplay.com/device-v2/devices/mine";
const MQTT_URL = "wss://aqrphjqbp3u2z-ats.iot.eu-west-2.amazonaws.com";
const KEEPALIVE = 300;
const ICON_UPLOAD_URL = "https://api.yotoplay.com/media/displayIcons/user/me/upload";

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

let currentRGB = PALETTE_COLORS[2]; // default red
let currentAlpha = 255; // 0-255
let pixelData = new Array(GRID_SIZE * GRID_SIZE).fill("#000000FF"); // 8-digit hex #RRGGBBAA
let deviceId = null;
let mqttClient = null;
let accessToken = null;
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
  accessToken = await auth.getValidAccessToken();

  if (!accessToken) {
    loginBtn.classList.remove("hidden");
    loginBtn.onclick = auth.startAuth;
    return;
  }

  status("Fetching device info...");
  try {
    const res = await fetch(API_ME, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const { devices } = await res.json();

    if (!devices || devices.length === 0) {
      status("No devices found on your account");
      return;
    }

    // Helper function to show editor UI after connection
    async function connectAndShowEditor(selectedDevice) {
      deviceId = selectedDevice.deviceId;
      status(`Connecting to ${selectedDevice.name}...`);
      await connectMqtt(accessToken, deviceId);
      if (!hasMultipleDevices) {
        deviceSelect.classList.add("hidden");
      }
      connectBtn.classList.add("hidden");
      paletteDiv.style.display = "flex";
      alphaSlider.parentElement.style.display = "flex";
      gridCanvas.style.display = "block";
      sendBtn.style.display = "block";
      buildPalette();
      initAlphaSlider();
      drawFullGrid();
      status("Connected. Ready!");
    }

    // Helper function for device switch
    async function handleDeviceSwitch() {
      const newId = deviceSelect.value;
      if (newId === deviceId) return;

      const newDevice = devices.find((d) => d.deviceId === newId);
      if (!newDevice.online) {
        status("Selected device is offline");
        deviceSelect.value = deviceId;
        return;
      }

      if (mqttClient) mqttClient.end();
      await connectAndShowEditor(newDevice);
    }

    // Populate dropdown
    devices.forEach((d) => {
      const option = document.createElement("option");
      option.value = d.deviceId;
      option.textContent = `${d.name} (${d.online ? "Online" : "Offline"})`;
      deviceSelect.appendChild(option);
    });

    const onlineDevices = devices.filter((d) => d.online);
    const hasMultipleDevices = devices.length > 1;

    if (!hasMultipleDevices) {
      // Single device case
      const singleDevice = devices[0];
      if (singleDevice.online) {
        await connectAndShowEditor(singleDevice);
      } else {
        deviceSelect.classList.remove("hidden");
        connectBtn.classList.remove("hidden");
      }
    } else {
      // Multiple devices case
      deviceSelect.classList.remove("hidden");

      if (onlineDevices.length > 0) {
        const firstOnline = onlineDevices[0];
        deviceSelect.value = firstOnline.deviceId;
        await connectAndShowEditor(firstOnline);
        deviceSelect.onchange = handleDeviceSwitch;
      } else {
        connectBtn.classList.remove("hidden");
      }
    }

    // Manual connect button handler
    connectBtn.onclick = async () => {
      const selectedId = deviceSelect.value;
      if (!selectedId) {
        status("Select a device");
        return;
      }

      const selectedDevice = devices.find((d) => d.deviceId === selectedId);
      if (!selectedDevice.online) {
        status("Selected device is offline");
        return;
      }

      await connectAndShowEditor(selectedDevice);
    };

    appDiv.classList.remove("hidden");
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
      document
        .querySelectorAll(".swatch")
        .forEach((el) => el.classList.remove("active"));
      swatch.classList.add("active");
    };
    paletteDiv.appendChild(swatch);
  });
}

function initAlphaSlider() {
  alphaSlider.value = currentAlpha;
  alphaValue.textContent = currentAlpha;
  alphaSlider.addEventListener("input", (e) => {
    currentAlpha = parseInt(e.target.value, 10);
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
});

gridCanvas.addEventListener("mousemove", (e) => {
  if (isDragging) handlePaint(e);
});

gridCanvas.addEventListener("mouseup", () => {
  isDragging = false;
});

gridCanvas.addEventListener("mouseleave", () => {
  isDragging = false;
});

// Touch events
gridCanvas.addEventListener("touchstart", (e) => {
  e.preventDefault();
  isDragging = true;
  handlePaint(e);
});

gridCanvas.addEventListener("touchmove", (e) => {
  e.preventDefault();
  if (isDragging) handlePaint(e);
});

gridCanvas.addEventListener("touchend", (e) => {
  e.preventDefault();
  isDragging = false;
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

async function uploadIconToYoto(iconBlob, token) {
  const uploadUrl = new URL(ICON_UPLOAD_URL);
  uploadUrl.searchParams.set("autoConvert", "true");
  uploadUrl.searchParams.set("filename", "matrix-icon.png");

  const res = await fetch(uploadUrl.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": iconBlob.type || "image/png",
    },
    body: iconBlob,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Yoto icon upload failed: ${res.status} ${errText}`);
  }

  const uploadResult = await res.json();

  const displayIcon = uploadResult?.displayIcon || {};
  const fullUrl = displayIcon.url;
  if (!fullUrl) throw new Error("No icon URL returned from Yoto upload");

  return { fullUrl };
}

/* ---------- Send Button ---------- */
sendBtn.addEventListener("click", async () => {
  if (!mqttClient || !mqttClient.connected) {
    status("MQTT not connected");
    return;
  }
  if (!accessToken) {
    status("Missing access token");
    return;
  }

  status("Uploading icon to Yoto...");
  try {
    const smallCanvas = document.createElement("canvas");
    smallCanvas.width = GRID_SIZE;
    smallCanvas.height = GRID_SIZE;
    const smallCtx = smallCanvas.getContext("2d");

    smallCtx.drawImage(
      gridCanvas,
      0,
      0,
      gridCanvas.width,
      gridCanvas.height,
      0,
      0,
      smallCanvas.width,
      smallCanvas.height
    );

    const iconBlob = await new Promise((resolve, reject) => {
      smallCanvas.toBlob((blob) => {
        if (!blob) reject(new Error("Failed to convert icon to blob"));
        else resolve(blob);
      }, "image/png");
    });

    const { fullUrl } = await uploadIconToYoto(iconBlob, accessToken);
    const uri = fullUrl;

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
    status("Yoto upload error – see console");
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
      const topics = [
        `device/${deviceId}/events`,
        `device/${deviceId}/status`,
        `device/${deviceId}/response`,
      ];
      mqttClient.subscribe(topics, { qos: 0 }, (err) => {
        if (err) console.error("MQTT subscribe error", err);
      });
      resolve();
    });

    mqttClient.on("message", (topic) => {
      const [, topicDeviceId] = topic.split("/");
      if (topicDeviceId !== deviceId) return;
    });

    mqttClient.on("error", (err) => {
      console.error("MQTT error", err);
      status("MQTT error");
      reject(err);
    });
  });
}

function status(msg) {
  statusP.textContent = msg;
}
