// driver.js
// WebHID driver for compatible right-hand controller + strain-sensing ring accessory.
// Exposed as: window.JoyRing (state + connect/disconnect + events)
// Compatible with devices using the same HID protocol. All product names are trademarks of their respective owners.

(() => {
    const NINTENDO_VENDOR_ID = 0x057E;
    const RUMBLE_NEUTRAL = [0x00, 0x01, 0x40, 0x40, 0x00, 0x01, 0x40, 0x40];

    const clamp01 = (v) => Math.max(0, Math.min(1, v));

    // Standard 0x30 mapping
    const BUTTONS = [
        { key: "Y", byte: "R", bit: 0x01 }, { key: "X", byte: "R", bit: 0x02 }, { key: "B", byte: "R", bit: 0x04 }, { key: "A", byte: "R", bit: 0x08 },
        { key: "SR(R)", byte: "R", bit: 0x10 }, { key: "SL(R)", byte: "R", bit: 0x20 }, { key: "R", byte: "R", bit: 0x40 }, { key: "ZR", byte: "R", bit: 0x80 },
        { key: "Minus", byte: "S", bit: 0x01 }, { key: "Plus", byte: "S", bit: 0x02 }, { key: "RStick", byte: "S", bit: 0x04 }, { key: "LStick", byte: "S", bit: 0x08 },
        { key: "Home", byte: "S", bit: 0x10 }, { key: "Capture", byte: "S", bit: 0x20 }, { key: "Grip", byte: "S", bit: 0x80 },
        { key: "Down", byte: "L", bit: 0x01 }, { key: "Up", byte: "L", bit: 0x02 }, { key: "Right", byte: "L", bit: 0x04 }, { key: "Left", byte: "L", bit: 0x08 },
        { key: "SR(L)", byte: "L", bit: 0x10 }, { key: "SL(L)", byte: "L", bit: 0x20 }, { key: "L", byte: "L", bit: 0x40 }, { key: "ZL", byte: "L", bit: 0x80 },
    ];

    function decodeButtons(full) {
        const bR = full[3], bS = full[4], bL = full[5];
        const out = {};
        for (const b of BUTTONS) {
            const src = b.byte === "R" ? bR : (b.byte === "S" ? bS : bL);
            out[b.key] = (src & b.bit) !== 0;
        }
        return out;
    }

    // Stick 12-bit decode (3 bytes)
    function decodeStick(raw3) {
        const b0 = raw3[0], b1 = raw3[1], b2 = raw3[2];
        const x = b0 | ((b1 & 0x0F) << 8);
        const y = (b1 >> 4) | (b2 << 4);
        return { x, y };
    }

    // Ring strain: WebHID payload buffer offset 38..39 int16 LE (mascii demo pattern)
    function readRingStrain(buffer) {
        return new DataView(buffer, 38, 2).getInt16(0, true);
    }

    // IMU: 0x30 report, first sample at payload offset 12 (accel X,Y,Z + gyro X,Y,Z, each int16 LE)
    function readIMU(buffer) {
        if (buffer.byteLength < 24) return null;
        const dv = new DataView(buffer, 12, 12);
        return {
            accel: { x: dv.getInt16(0, true), y: dv.getInt16(2, true), z: dv.getInt16(4, true) },
            gyro: { x: dv.getInt16(6, true), y: dv.getInt16(8, true), z: dv.getInt16(10, true) },
        };
    }

    // Driver internal state
    const state = {
        connected: false,
        productName: null,
        isJoyConR: null,
        reportId: null,
        timer: null,
        batteryNibble: null,
        buttons: {},
        sticks: {
            left: { x: 2048, y: 2048 },
            right: { x: 2048, y: 2048 },
        },
        ring: {
            strainRaw: 0,
            neutral: null,
            delta: 0,
        },
        imu: {
            accel: { x: 0, y: 0, z: 0 },
            gyro: { x: 0, y: 0, z: 0 },
        },
        lastUpdateTs: null,
    };

    let dev = null;
    let pkt = 0;
    let initialized = false;

    const listeners = new Set(); // functions(state)
    function emit() {
        state.lastUpdateTs = new Date().toISOString();
        // Event for DOM listeners
        window.dispatchEvent(new CustomEvent("joyring:update", { detail: structuredClone(state) }));
        // Direct listeners
        for (const fn of listeners) {
            try { fn(state); } catch { }
        }
    }

    function nextPkt() {
        const v = pkt & 0x0f;
        pkt = (pkt + 1) & 0x0f;
        return v;
    }

    async function sendSubcommand(subcommandBytes, rumble = RUMBLE_NEUTRAL) {
        if (!dev?.opened) throw new Error("Device not open.");
        const p = nextPkt();
        const data = new Uint8Array(1 + 8 + subcommandBytes.length);
        data[0] = p;
        data.set(rumble, 1);
        data.set(subcommandBytes, 1 + 8);
        await dev.sendReport(0x01, data);
    }

    function waitForSubcommandReply(expected, timeoutMs = 5000, timeoutMsg = "timeout") {
        return new Promise((resolve, reject) => {
            const t = setTimeout(() => {
                dev.removeEventListener("inputreport", on);
                reject(new Error(timeoutMsg));
            }, timeoutMs);

            const on = (e) => {
                if (e.reportId !== 0x21) return;
                const data = new Uint8Array(e.data.buffer); // payload only
                for (const [posStr, val] of Object.entries(expected)) {
                    const pos = Number(posStr);
                    if (data[pos - 1] !== val) return;
                }
                clearTimeout(t);
                dev.removeEventListener("inputreport", on);
                resolve();
            };

            dev.addEventListener("inputreport", on);
        });
    }

    function waitForFirstNonZeroStrain(timeoutMs = 6000) {
        return new Promise((resolve, reject) => {
            const t = setTimeout(() => {
                dev.removeEventListener("inputreport", on);
                reject(new Error("Neutral strain timeout"));
            }, timeoutMs);

            const on = (e) => {
                if (e.reportId !== 0x30) return;
                const s = readRingStrain(e.data.buffer);
                if (s !== 0) {
                    clearTimeout(t);
                    dev.removeEventListener("inputreport", on);
                    resolve(s);
                }
            };

            dev.addEventListener("inputreport", on);
        });
    }

    async function initAndEnableRingCon() {
        // idempotent
        if (initialized) return;
        initialized = true;

        // Set input report mode 0x30
        await sendSubcommand([0x03, 0x30], [0, 0, 0, 0, 0, 0, 0, 0]);
        await waitForSubcommandReply({ 14: 0x03 }, 3000, "No ACK for report mode");

        // Enable IMU
        await sendSubcommand([0x40, 0x01], [0, 0, 0, 0, 0, 0, 0, 0]);
        await waitForSubcommandReply({ 14: 0x40 }, 3000, "No ACK for IMU");

        // Enable rumble
        await sendSubcommand([0x48, 0x01], RUMBLE_NEUTRAL);
        await waitForSubcommandReply({ 14: 0x48 }, 3000, "No ACK for rumble");

        // Ring accessory enable sequence (MCU + external polling)
        await sendSubcommand([0x22, 0x01], [0, 0, 0, 0, 0, 0, 0, 0]);
        await waitForSubcommandReply({ 13: 0x80, 14: 0x22 }, 5000, "No ACK for MCU");

        await sendSubcommand([
            0x21, 0x21, 0x01, 0x01,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0xF3,
        ], [0, 0, 0, 0, 0, 0, 0, 0]);
        await waitForSubcommandReply({ 14: 0x21 }, 5000, "No ACK for MCU config");

        await sendSubcommand([0x59], [0, 0, 0, 0, 0, 0, 0, 0]);
        await waitForSubcommandReply({ 14: 0x59, 16: 0x20 }, 5000, "Ring accessory not found");

        await sendSubcommand([
            0x5C, 0x06, 0x03, 0x25, 0x06, 0x00, 0x00, 0x00, 0x00,
            0x1C, 0x16, 0xED, 0x34, 0x36, 0x00, 0x00, 0x00, 0x0A,
            0x64, 0x0B, 0xE6, 0xA9, 0x22, 0x00, 0x00, 0x04, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x90, 0xA8, 0xE1,
            0x34, 0x36,
        ], [0, 0, 0, 0, 0, 0, 0, 0]);
        await waitForSubcommandReply({ 14: 0x5C }, 5000, "No ACK for ext format");

        await sendSubcommand([0x5A, 0x04, 0x01, 0x01, 0x02], [0, 0, 0, 0, 0, 0, 0, 0]);
        await waitForSubcommandReply({ 14: 0x5A }, 5000, "No ACK for polling");

        // Calibrate neutral
        state.ring.neutral = await waitForFirstNonZeroStrain(6000);
        emit();
    }

    function onInputReport(e) {
        if (e.reportId !== 0x30) return;

        const payload = new Uint8Array(e.data.buffer); // without reportId
        const full = new Uint8Array(payload.length + 1);
        full[0] = e.reportId;
        full.set(payload, 1);

        state.reportId = e.reportId;
        state.timer = full[1];
        state.batteryNibble = (full[2] >> 4) & 0x0F;

        // Buttons
        state.buttons = decodeButtons(full);

        // Sticks: right-hand unit only exposes right stick
        const rStick = decodeStick(full.slice(9, 12));
        state.sticks.right = rStick;

        if (state.isJoyConR) {
            state.sticks.left = { x: 2048, y: 2048 };
        } else {
            state.sticks.left = decodeStick(full.slice(6, 9));
        }

        // Ring
        let strain = 0;
        try { strain = readRingStrain(e.data.buffer); } catch { strain = 0; }
        state.ring.strainRaw = strain;

        const neutral = state.ring.neutral;
        state.ring.delta = (typeof neutral === "number") ? (strain - neutral) : 0;

        // IMU (0x30: first sample at payload offset 12)
        const imu = readIMU(e.data.buffer);
        if (imu) {
            state.imu.accel = imu.accel;
            state.imu.gyro = imu.gyro;
        }

        emit();
    }

    function onDisconnected() {
        state.connected = false;
        state.productName = null;
        state.isJoyConR = null;
        initialized = false;
        dev = null;
        emit();
    }

    async function connect() {
        if (!("hid" in navigator)) throw new Error("WebHID not available (Chrome/Edge Desktop).");

        const devices = await navigator.hid.requestDevice({
            filters: [{ vendorId: NINTENDO_VENDOR_ID }]
        });

        dev = devices[0];
        if (!dev) throw new Error("No device selected.");

        await dev.open();
        dev.addEventListener("inputreport", onInputReport);
        dev.addEventListener("disconnect", onDisconnected);

        state.connected = true;
        state.productName = dev.productName || "";
        state.isJoyConR = state.productName.includes("(R)");
        emit();

        // auto init + ring-con enable
        await initAndEnableRingCon();
    }

    async function disconnect() {
        if (dev?.opened) await dev.close();
        onDisconnected();
    }

    // Public API
    window.JoyRing = {
        state,
        connect,
        disconnect,
        onUpdate(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    };
})();