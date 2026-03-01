# JoyRing

Browser-based access to compatible **WebHID** controllers and strain-sensing ring accessories. Read buttons, sticks, IMU (accel/gyro), and ring push/pull in real time — and play the included rhythm game **Cube Saber**.

**Compatibility:** Right-hand controller + ring accessory using the same HID protocol (e.g. hardware sold for fitness games). Product names are trademarks of their respective owners; this project is not affiliated with or endorsed by any vendor.

---

## Contents

- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Project structure](#project-structure)
- [JoyRing Viewer](#joyring-viewer-indexhtml)
- [Cube Saber (demo game)](#cube-saber-demo_gamegamehtml)
- [Using the driver](#using-the-driver)
- [API reference](#api-windowjoyring)
- [Trademarks / legal](#trademarks--legal)

---

## Requirements

- **Chrome** or **Edge** (desktop) with WebHID
- Compatible right-hand controller and ring accessory (same HID protocol)
- **Local server** with repo root as document root (so `demo_game/game.html` can load `../driver.js`)

---

## Quick start

```bash
cd /path/to/joyconring
npx serve .
# → http://localhost:3000/
# → http://localhost:3000/demo_game/game.html
```

---

## Project structure

| File | Description |
|------|-------------|
| `driver.js` | WebHID driver: connect, init (0x30 + IMU + rumble + ring), exposes `window.JoyRing` |
| `index.html` | **JoyRing Viewer**: live buttons, stick, ring, IMU, JSON |
| `viewer.js` | Viewer UI logic |
| `demo_game/game.html` | **Cube Saber**: rhythm game with ring push/pull and L/C/R lanes |

---

## JoyRing Viewer (`index.html`)

1. Click **Connect** and select the device in the browser picker.
2. The driver initializes and streams into `window.JoyRing.state`.

Displayed: **buttons** (green = pressed), **right stick** (X/Y), **ring** (strain, neutral, delta), **IMU** (accel & gyro raw), **JSON** and **log**.

---

## Cube Saber (`demo_game/game.html`)

Rhythm game: cubes move toward you; destroy them in the hit zone with the right **action** and **lane**.

### Actions

- **Red cubes** → **squeeze** the ring (push).
- **Blue cubes** → **pull** the ring apart.

### Lanes (L / C / R)

Choose one:

1. **Right stick** — Move stick left / center / right. No calibration. Button: *Always use R-Stick for lanes*.
2. **IMU (tilt)** — Calibrate once, then orientation from ring movement:
   - **3-step calibration:** Hold ring **right** → Next, **center** → Next, **left** → Next. We store one **normalized accel vector** per position. In game, the current accel vector is compared to these three with **cosine similarity**; the closest match is L, C, or R.
   - **Stealth calibration:** *Learn from movement* — play with the stick for 15 seconds while vectors are recorded; then L/C/R switch to tilt automatically.

### Game flow

1. **Connect controller** → **Start Game**.
2. **Calibration screen:** Pick *Use R-Stick*, *Stealth*, or do the 3 steps (right → center → left).
3. **Countdown** 3, 2, 1, Go — then cubes spawn.
4. **Lives:** 3 hearts; one miss = one life lost. Game over at 0.
5. **Score & combo:** Combo bonus at 5 and 10; speed increases over time. Best score saved in `localStorage`.
6. **Game over** → *Play Again* (same calibration) or reconnect from menu.

### Controls

- **Ring:** Push / pull for red / blue.
- **Lanes:** Stick or calibrated tilt (see above).
- **Keyboard (testing):** `A` = pull, `D` = push.

---

## Using the driver

### Include the driver

```html
<!-- Page in repo root -->
<script src="driver.js"></script>

<!-- Page in subfolder (e.g. demo_game/game.html) -->
<script src="../driver.js"></script>
```

Connection requires a **user gesture** (e.g. button click). No auto-connect.

### Connect

```js
try {
  await window.JoyRing.connect();
} catch (err) {
  console.error(err.message); // e.g. "No device selected."
}
```

After success: report mode 0x30, IMU and rumble enabled, ring MCU/polling enabled, neutral strain measured; then continuous updates to `state`.

### State object

`window.JoyRing.state` is updated in place on each HID report. Do not replace it; only read (or mutate) its properties.

| Property | Description |
|----------|-------------|
| `connected` | `true` when device is open |
| `productName` | Device name from hardware |
| `buttons` | `{ Y, X, B, A, … }` → `true` / `false` |
| `sticks.left`, `sticks.right` | `{ x, y }` in 0–4095 (center ~2048) |
| `ring.strainRaw`, `ring.neutral`, `ring.delta` | Raw strain, rest value, push/pull delta |
| `imu.accel`, `imu.gyro` | `{ x, y, z }` int16 raw |
| `lastUpdateTs` | ISO string of last update |

Right-hand units typically only expose the right stick; left is fixed at 2048.

### Getting data

- **Direct read:** `window.JoyRing.state` in a loop or `requestAnimationFrame`.
- **Event:** `window.addEventListener("joyring:update", (e) => { const s = e.detail; });` — `e.detail` is a **clone** of `state`.
- **Callback:** `window.JoyRing.onUpdate((state) => { … })` — returns an unsubscribe function.

No need to poll from a timer if you use the event or `onUpdate`.

### Disconnect

```js
await window.JoyRing.disconnect();
```

Then `state.connected === false`. Call `connect()` again after a new user gesture to reconnect.

### Minimal example

```html
<button id="connect">Connect</button>
<pre id="out">Not connected.</pre>
<script src="driver.js"></script>
<script>
  document.getElementById("connect").onclick = async () => {
    try {
      await window.JoyRing.connect();
      document.getElementById("out").textContent = "Connected: " + window.JoyRing.state.productName;
    } catch (e) {
      document.getElementById("out").textContent = "Error: " + e.message;
    }
  };
  window.addEventListener("joyring:update", (e) => {
    const s = e.detail;
    if (!s.connected) return;
    document.getElementById("out").textContent = JSON.stringify({ buttons: s.buttons, ring: s.ring, imu: s.imu }, null, 2);
  });
</script>
```

Serve from repo root so `driver.js` loads.

---

## API (`window.JoyRing`)

| Method / property | Description |
|-------------------|-------------|
| `connect()`       | Open device picker, init device. Returns a Promise. |
| `disconnect()`    | Close device. Returns a Promise. |
| `state`           | Live state object (see above). |
| `onUpdate(fn)`    | `fn(state)` on every update. Returns unsubscribe. |

**Event:** `joyring:update` — `e.detail` is a clone of `state`.

---

## Trademarks / legal

Product and company names may be trademarks of their respective owners. Their use here is for compatibility description only and does not imply endorsement or affiliation. This project is independent of any hardware or game manufacturer.

---

