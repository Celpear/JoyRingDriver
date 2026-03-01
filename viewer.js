// viewer.js
// Consumes window.JoyRing.state + joyring:update event and renders UI.

(() => {
    const $ = (id) => document.getElementById(id);

    const btnConnect = $("btnConnect");
    const btnDisconnect = $("btnDisconnect");
    const statusEl = $("status");
    const jsonOut = $("jsonOut");
    const logOut = $("logOut");
    const btnCopy = $("btnCopy");

    const rxFill = $("rxFill");
    const ryFill = $("ryFill");
    const rxVal = $("rxVal");
    const ryVal = $("ryVal");

    const ringDelta = $("ringDelta");
    const ringFill = $("ringFill");
    const ringNeutral = $("ringNeutral");
    const ringRaw = $("ringRaw");

    const imuAccelX = $("imuAccelX");
    const imuAccelY = $("imuAccelY");
    const imuAccelZ = $("imuAccelZ");
    const imuGyroX = $("imuGyroX");
    const imuGyroY = $("imuGyroY");
    const imuGyroZ = $("imuGyroZ");

    const buttonsEl = $("buttons");

    const log = (...args) => {
        const line = args.join(" ");
        logOut.textContent += line + "\n";
        logOut.scrollTop = logOut.scrollHeight;
    };

    const setStatus = (text, cls) => {
        statusEl.textContent = text;
        statusEl.className = "pill " + cls;
    };

    const clamp01 = (v) => Math.max(0, Math.min(1, v));

    // Build buttons UI once
    const BUTTON_ORDER = [
        "Y", "X", "B", "A", "R", "ZR", "SR(R)", "SL(R)",
        "Minus", "Plus", "Home", "Capture", "RStick", "LStick", "Grip",
        "Up", "Down", "Left", "Right", "L", "ZL", "SR(L)", "SL(L)"
    ];

    const btnDom = new Map();
    function initButtons() {
        buttonsEl.innerHTML = "";
        for (const name of BUTTON_ORDER) {
            const item = document.createElement("div");
            item.className = "btnItem";
            const label = document.createElement("div");
            label.className = "btnName";
            label.textContent = name;
            const lamp = document.createElement("div");
            lamp.className = "lamp";
            item.appendChild(label);
            item.appendChild(lamp);
            buttonsEl.appendChild(item);
            btnDom.set(name, lamp);
        }
    }
    initButtons();

    function render(state) {
        // status
        if (!state.connected) {
            setStatus("Not connected", "warn");
            btnConnect.disabled = false;
            btnDisconnect.disabled = true;
            return;
        }
        setStatus("Ready", "ok");
        btnConnect.disabled = true;
        btnDisconnect.disabled = false;

        // buttons
        for (const name of BUTTON_ORDER) {
            const on = !!state.buttons?.[name];
            btnDom.get(name)?.classList.toggle("on", on);
        }

        // right stick only
        const rx = state.sticks?.right?.x ?? 2048;
        const ry = state.sticks?.right?.y ?? 2048;
        rxFill.style.width = (clamp01(rx / 4095) * 100).toFixed(1) + "%";
        ryFill.style.width = (clamp01(ry / 4095) * 100).toFixed(1) + "%";
        rxVal.textContent = String(rx);
        ryVal.textContent = String(ry);

        // ring
        ringNeutral.textContent = (state.ring?.neutral ?? "—");
        ringRaw.textContent = (state.ring?.strainRaw ?? "—");
        ringDelta.textContent = (state.ring?.delta ?? 0);

        // center bar at 50%, range +/- 2048
        const range = 2048;
        const delta = state.ring?.delta ?? 0;
        const norm = clamp01((delta + range) / (2 * range));
        ringFill.style.width = (norm * 100).toFixed(1) + "%";

        // IMU
        const accel = state.imu?.accel;
        const gyro = state.imu?.gyro;
        if (accel) {
            imuAccelX.textContent = accel.x;
            imuAccelY.textContent = accel.y;
            imuAccelZ.textContent = accel.z;
        }
        if (gyro) {
            imuGyroX.textContent = gyro.x;
            imuGyroY.textContent = gyro.y;
            imuGyroZ.textContent = gyro.z;
        }

        // json
        jsonOut.textContent = JSON.stringify(state, null, 2);
    }

    // Events
    btnConnect.addEventListener("click", async () => {
        try {
            setStatus("Connecting…", "warn");
            await window.JoyRing.connect();
            log("Connected:", window.JoyRing.state.productName || "");
        } catch (e) {
            log("Connect error:", e.message || String(e));
            setStatus("Error", "bad");
            btnConnect.disabled = false;
            btnDisconnect.disabled = true;
        }
    });

    btnDisconnect.addEventListener("click", async () => {
        await window.JoyRing.disconnect();
        log("Disconnected");
        render(window.JoyRing.state);
    });

    btnCopy.addEventListener("click", async () => {
        await navigator.clipboard.writeText(jsonOut.textContent);
        const old = btnCopy.textContent;
        btnCopy.textContent = "Copied ✓";
        setTimeout(() => btnCopy.textContent = old, 1200);
    });

    window.addEventListener("joyring:update", (ev) => {
        render(ev.detail);
    });

    // initial render
    render(window.JoyRing?.state ?? { connected: false });
})();