const API_ME = "https://api.yotoplay.com/device-v2/devices/mine";
const ICON_UPLOAD_URL = "https://api.yotoplay.com/media/displayIcons/user/me/upload";
const MQTT_URL = "wss://aqrphjqbp3u2z-ats.iot.eu-west-2.amazonaws.com";
const KEEPALIVE = 300;

const GRID_SIZE = 16;
const CELL_PX = 20;
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

let accessToken = null;
let deviceId = null;
let mqttClient = null;
let devices = [];
let hasMultipleDevices = false;

let currentRGB = PALETTE_COLORS[2];
let currentAlpha = 255;
let pixelData = new Array(GRID_SIZE * GRID_SIZE).fill("#000000FF");
let isDragging = false;

const loginBtn = document.getElementById("loginBtn");
const appDiv = document.getElementById("app");
const statusP = document.getElementById("status");
const deviceSelect = document.getElementById("deviceSelect");
const connectBtn = document.getElementById("connectBtn");
const refreshStatusBtn = document.getElementById("refreshStatusBtn");
const refreshEventsBtn = document.getElementById("refreshEventsBtn");

const paletteDiv = document.getElementById("palette");
const alphaSlider = document.getElementById("alphaSlider");
const alphaValue = document.getElementById("alphaValue");
const gridCanvas = document.getElementById("grid");
const ctx = gridCanvas.getContext("2d");
const sendBtn = document.getElementById("sendBtn");

const volumeSlider = document.getElementById("volumeSlider");
const volumeValue = document.getElementById("volumeValue");
const setVolumeBtn = document.getElementById("setVolumeBtn");
const sleepSeconds = document.getElementById("sleepSeconds");
const setSleepBtn = document.getElementById("setSleepBtn");
const clearSleepBtn = document.getElementById("clearSleepBtn");
const ambientColor = document.getElementById("ambientColor");
const setAmbientBtn = document.getElementById("setAmbientBtn");

const cardUri = document.getElementById("cardUri");
const chapterKey = document.getElementById("chapterKey");
const trackKey = document.getElementById("trackKey");
const secondsIn = document.getElementById("secondsIn");
const cutOff = document.getElementById("cutOff");
const anyButtonStop = document.getElementById("anyButtonStop");
const cardStartBtn = document.getElementById("cardStartBtn");
const cardPauseBtn = document.getElementById("cardPauseBtn");
const cardResumeBtn = document.getElementById("cardResumeBtn");
const cardStopBtn = document.getElementById("cardStopBtn");

const bluetoothOnPayload = document.getElementById("bluetoothOnPayload");
const bluetoothConnectPayload = document.getElementById("bluetoothConnectPayload");
const bluetoothOnBtn = document.getElementById("bluetoothOnBtn");
const bluetoothOffBtn = document.getElementById("bluetoothOffBtn");
const bluetoothStateBtn = document.getElementById("bluetoothStateBtn");
const bluetoothConnectBtn = document.getElementById("bluetoothConnectBtn");
const bluetoothDisconnectBtn = document.getElementById("bluetoothDisconnectBtn");
const bluetoothDeleteBondsBtn = document.getElementById("bluetoothDeleteBondsBtn");

const rebootBtn = document.getElementById("rebootBtn");

const eventsJson = document.getElementById("eventsJson");
const statusJson = document.getElementById("statusJson");
const responseJson = document.getElementById("responseJson");

window.addEventListener("load", init);

async function init() {
  await auth.completeAuth();
  accessToken = await auth.getValidAccessToken();

  if (!accessToken) {
    loginBtn.classList.remove("hidden");
    loginBtn.onclick = auth.startAuth;
    return;
  }

  appDiv.classList.remove("hidden");
  setupEditor();
  setupControls();

  try {
    await loadDevices();
  } catch (err) {
    console.error(err);
    status("Error fetching devices - see console");
  }
}

async function loadDevices() {
  status("Fetching devices...");
  const res = await fetch(API_ME, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await res.json();

  if (!res.ok) {
    throw new Error(`Device fetch failed: ${res.status} ${JSON.stringify(body)}`);
  }

  devices = body.devices || [];
  hasMultipleDevices = devices.length > 1;

  if (devices.length === 0) {
    status("No devices found on your account");
    return;
  }

  deviceSelect.innerHTML = "";
  devices.forEach((d) => {
    const option = document.createElement("option");
    option.value = d.deviceId;
    option.textContent = `${d.name} (${d.online ? "Online" : "Offline"})`;
    deviceSelect.appendChild(option);
  });

  const firstOnline = devices.find((d) => d.online);
  if (firstOnline) {
    deviceSelect.value = firstOnline.deviceId;
    await connectToDevice(firstOnline.deviceId);
  } else {
    status("No online devices. Pick a device and retry.");
    connectBtn.classList.remove("hidden");
  }

  deviceSelect.onchange = async () => {
    const selectedId = deviceSelect.value;
    if (selectedId === deviceId) return;
    const selected = devices.find((d) => d.deviceId === selectedId);
    if (!selected || !selected.online) {
      status("Selected device is offline");
      deviceSelect.value = deviceId || "";
      return;
    }
    await connectToDevice(selected.deviceId);
  };

  connectBtn.onclick = async () => {
    const selected = devices.find((d) => d.deviceId === deviceSelect.value);
    if (!selected) {
      status("Select a device");
      return;
    }
    if (!selected.online) {
      status("Selected device is offline");
      return;
    }
    await connectToDevice(selected.deviceId);
  };
}

async function connectToDevice(targetDeviceId) {
  if (!targetDeviceId) return;

  const selected = devices.find((d) => d.deviceId === targetDeviceId);
  status(`Connecting to ${selected?.name || targetDeviceId}...`);

  if (mqttClient) mqttClient.end();
  deviceId = targetDeviceId;
  connectBtn.classList.add("hidden");

  await connectMqtt(accessToken, deviceId);

  if (!hasMultipleDevices) {
    deviceSelect.classList.add("hidden");
  }

  status("Connected. Ready!");
  publishCommand("status/request", {});
  publishCommand("events/request", {});
}

function setupEditor() {
  buildPalette();
  alphaSlider.value = currentAlpha;
  alphaValue.textContent = String(currentAlpha);

  alphaSlider.oninput = (e) => {
    currentAlpha = parseInt(e.target.value, 10);
    alphaValue.textContent = String(currentAlpha);
  };

  drawFullGrid();

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

  sendBtn.onclick = async () => {
    if (!accessToken) {
      status("Missing access token");
      return;
    }

    try {
      status("Uploading icon to Yoto...");
      const iconBlob = await renderIconBlob();
      const { fullUrl } = await uploadIconToYoto(iconBlob, accessToken);
      publishCommand("display/preview", {
        uri: fullUrl,
        timeout: 30,
        animated: 0,
      });
    } catch (err) {
      console.error(err);
      status("Yoto upload error - see console");
    }
  };
}

function setupControls() {
  refreshStatusBtn.onclick = () => publishCommand("status/request", {});
  refreshEventsBtn.onclick = () => publishCommand("events/request", {});

  volumeSlider.oninput = () => {
    volumeValue.textContent = volumeSlider.value;
  };

  setVolumeBtn.onclick = () => {
    const volume = Number(volumeSlider.value);
    publishCommand("volume/set", { volume });
  };

  setSleepBtn.onclick = () => {
    const seconds = Math.max(0, Number(sleepSeconds.value || 0));
    publishCommand("sleep-timer/set", { duration: seconds });
  };

  clearSleepBtn.onclick = () => {
    publishCommand("sleep-timer/set", { duration: 0 });
  };

  setAmbientBtn.onclick = () => {
    publishCommand("ambients/set", {
      color: hexToRgb(ambientColor.value),
      enabled: true,
    });
  };

  cardStartBtn.onclick = () => {
    const payload = {
      uri: cardUri.value.trim(),
      anyButtonStop: anyButtonStop.checked,
    };

    if (chapterKey.value.trim()) payload.chapterKey = chapterKey.value.trim();
    if (trackKey.value.trim()) payload.trackKey = trackKey.value.trim();

    const seconds = Number(secondsIn.value);
    if (!Number.isNaN(seconds) && secondsIn.value !== "") payload.secondsIn = seconds;

    const cut = Number(cutOff.value);
    if (!Number.isNaN(cut) && cutOff.value !== "") payload.cutOff = cut;

    if (!payload.uri) {
      status("Card URI is required for start");
      return;
    }

    publishCommand("card/start", payload);
  };

  cardPauseBtn.onclick = () => publishCommand("card/pause", {});
  cardResumeBtn.onclick = () => publishCommand("card/resume", {});
  cardStopBtn.onclick = () => publishCommand("card/stop", {});

  bluetoothOnBtn.onclick = () => {
    publishCommand("bluetooth/on", safeJson(bluetoothOnPayload.value, {}));
  };
  bluetoothOffBtn.onclick = () => publishCommand("bluetooth/off", {});
  bluetoothStateBtn.onclick = () => publishCommand("bluetooth/state", {});
  bluetoothConnectBtn.onclick = () => {
    publishCommand(
      "bluetooth/connect",
      safeJson(bluetoothConnectPayload.value, {})
    );
  };
  bluetoothDisconnectBtn.onclick = () =>
    publishCommand("bluetooth/disconnect", {});
  bluetoothDeleteBondsBtn.onclick = () =>
    publishCommand("bluetooth/delete-bonds", {});

  rebootBtn.onclick = () => publishCommand("reboot", {});
}

function buildPalette() {
  paletteDiv.innerHTML = "";
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

function getCellCoords(e) {
  const rect = gridCanvas.getBoundingClientRect();
  const clientX = e.clientX || (e.touches && e.touches[0]?.clientX) || 0;
  const clientY = e.clientY || (e.touches && e.touches[0]?.clientY) || 0;
  return {
    x: Math.floor((clientX - rect.left) / CELL_PX),
    y: Math.floor((clientY - rect.top) / CELL_PX),
  };
}

function handlePaint(e) {
  const { x, y } = getCellCoords(e);
  if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) return;
  setPixel(x, y);
  drawCell(x, y);
}

function setPixel(x, y) {
  const alphaHex = currentAlpha.toString(16).padStart(2, "0").toUpperCase();
  pixelData[y * GRID_SIZE + x] = currentRGB + alphaHex;
}

function drawCell(x, y) {
  ctx.fillStyle = pixelData[y * GRID_SIZE + x];
  ctx.fillRect(x * CELL_PX, y * CELL_PX, CELL_PX, CELL_PX);
}

function drawFullGrid() {
  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      drawCell(x, y);
    }
  }
}

async function renderIconBlob() {
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

  return new Promise((resolve, reject) => {
    smallCanvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to convert icon to blob"));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
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
  const fullUrl = uploadResult?.displayIcon?.url;
  if (!fullUrl) throw new Error("No icon URL returned from Yoto upload");

  return { fullUrl };
}

function connectMqtt(token, targetDeviceId) {
  return new Promise((resolve, reject) => {
    mqttClient = mqtt.connect(MQTT_URL, {
      keepalive: KEEPALIVE,
      port: 443,
      protocol: "wss",
      username: `${targetDeviceId}?x-amz-customauthorizer-name=PublicJWTAuthorizer`,
      password: token,
      reconnectPeriod: 0,
      clientId: `DASH${targetDeviceId}`,
      ALPNProtocols: ["x-amzn-mqtt-ca"],
    });

    mqttClient.on("connect", () => {
      const topics = [
        `device/${targetDeviceId}/data/events`,
        `device/${targetDeviceId}/data/status`,
        `device/${targetDeviceId}/response`,
      ];

      mqttClient.subscribe(topics, { qos: 0 }, (err) => {
        if (err) {
          console.error("MQTT subscribe error", err);
          reject(err);
          return;
        }
        resolve();
      });
    });

    mqttClient.on("message", (topic, message) => {
      onMqttMessage(topic, message);
    });

    mqttClient.on("error", (err) => {
      console.error("MQTT error", err);
      status("MQTT error");
      reject(err);
    });
  });
}

function onMqttMessage(topic, message) {
  let payload;
  try {
    payload = JSON.parse(message.toString());
  } catch (err) {
    payload = { raw: message.toString(), parseError: String(err) };
  }

  if (topic.endsWith("/data/events")) {
    eventsJson.textContent = prettyJson(payload);
    return;
  }

  if (topic.endsWith("/data/status")) {
    statusJson.textContent = prettyJson(payload);
    syncUiFromStatus(payload);
    return;
  }

  if (topic.endsWith("/response")) {
    responseJson.textContent = prettyJson(payload);
    return;
  }
}

function syncUiFromStatus(payload) {
  const maybeVolume = payload?.state?.volume ?? payload?.volume;
  if (typeof maybeVolume === "number") {
    volumeSlider.value = String(Math.max(0, Math.min(100, maybeVolume)));
    volumeValue.textContent = volumeSlider.value;
  }
}

function publishCommand(command, body) {
  if (!mqttClient || !mqttClient.connected || !deviceId) {
    status("MQTT not connected");
    return;
  }

  const topic = `device/${deviceId}/command/${command}`;
  const request = {
    requestId: crypto.randomUUID(),
    ...body,
  };

  mqttClient.publish(topic, JSON.stringify(request), { qos: 0 }, (err) => {
    if (err) {
      console.error("Publish error", err);
      status(`Publish failed: ${command}`);
      return;
    }
    status(`Published ${command}`);
  });
}

function hexToRgb(hex) {
  const stripped = hex.replace("#", "");
  return {
    r: parseInt(stripped.slice(0, 2), 16),
    g: parseInt(stripped.slice(2, 4), 16),
    b: parseInt(stripped.slice(4, 6), 16),
  };
}

function safeJson(raw, fallback) {
  try {
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch {
    status("Invalid JSON payload");
    return fallback;
  }
}

function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function status(msg) {
  statusP.textContent = msg;
}
