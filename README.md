# Device Pilot – Ulanzi Deck Plugin

A plugin for the **Ulanzi Stream Controller** (D200 and compatible) that gives you one-tap system-wide control over audio output, microphone, and virtual camera on Windows.

---

## Features

| Button Type | Available Actions |
|---|---|
| **Audio Output** | Set a device as default · Toggle mute · Toggle between 2 devices |
| **Microphone** | Toggle mute · Set a device as default · Toggle between 2 devices |
| **Camera** | Mute / unmute virtual cam (black frame ↔ live) · Switch between 2 physical cameras |

- Button icons update live to reflect the current mute/active state
- Device names are shown directly on the button
- Windows toast notifications on every action
- No admin rights required for audio – camera switching also runs without elevation

---

## Requirements

| Component | Minimum version |
|---|---|
| Windows | 10 / 11 (x64) |
| Ulanzi Studio | 6.1 or newer |
| Node.js | 18 LTS or newer |
| Python | 3.10 or newer |

The installer handles all missing dependencies automatically.

---

## Installation

1. Download or clone this repository.
2. Open **PowerShell as Administrator** and run:

```powershell
powershell -ExecutionPolicy Bypass -File ".\installer\install.ps1"
```

The installer will:
- Check / install Node.js (via winget or direct download)
- Check / install Python (via winget)
- Copy the plugin to `%APPDATA%\Ulanzi\UlanziDeck\Plugins\`
- Install Python dependencies (`opencv-python`, `pyvirtualcam`, `fastapi`, `uvicorn`, `pygrabber`)
- Download and register the **Unity Capture** DirectShow filter (MIT license)
- Register two background services in Windows Task Scheduler:
  - `UlanziDevControlBridge` – Node.js HTTP bridge (port 3907)
  - `UlanziVirtualCamService` – Python virtual cam service (port 5000)
- Start both services immediately

3. Start **Ulanzi Studio** – the *Device Control* plugin appears in the action list.

---

## Uninstallation

```powershell
powershell -ExecutionPolicy Bypass -File ".\installer\uninstall.ps1"
```

This removes both Task Scheduler tasks, stops all services, unregisters the Unity Capture DirectShow filter, and deletes the plugin folder.

---

## Architecture

```
Ulanzi Studio
  └── plugin.js  (WebSocket, Ulanzi SDK)
        └── HTTP → bridge.js  (Node.js, port 3907)
                    ├── AudioControl.js  (COM: IPolicyConfig, IAudioEndpointVolume)
                    ├── CameraControl.js  (PnP device enumeration)
                    └── HTTP → main.py  (Python virtual cam, port 5000)
                                └── pyvirtualcam → Unity Capture DirectShow filter
```

### Services

| Service | Port | Technology | Purpose |
|---|---|---|---|
| Native Bridge | 3907 | Node.js | Audio COM calls, PnP camera list |
| Virtual Cam | 5000 | Python / FastAPI | Capture real webcam → virtual DirectShow device |

Both services start automatically at Windows login via Task Scheduler (no admin, `RunLevel Limited`).

---

## How the virtual camera works

`main.py` captures a physical webcam with OpenCV and forwards every frame to a **Unity Capture** virtual DirectShow device via `pyvirtualcam`.

- **Muted** → sends a black frame instead of the real video
- **Switching** → opens a new physical camera and closes the previous one between frames

The virtual device appears as **"Unity Video Capture"** in any video conferencing app (Teams, Zoom, OBS, etc.).

### First-time setup in Microsoft Teams

*Settings → Devices → Camera → select **Unity Video Capture***

---

## Button configuration

### Audio Output

| Setting | Description |
|---|---|
| Set as Default | Activates the selected device as the system default |
| Toggle Mute | Mutes / unmutes the current default output |
| Toggle Between 2 Devices | Switches between Device 1 and Device 2 on every press |

### Microphone

Same options as Audio Output, applied to recording devices.

### Camera

| Setting | Description |
|---|---|
| Toggle Mute / Live | Switches the virtual cam between black frame and live video |
| Switch Camera | Switches between Camera 1 and Camera 2 (by index) |

Camera indices are populated automatically from connected physical cameras when the property inspector is open.

---

## Troubleshooting

**Bridge not ready / button shows error**
- Make sure the Task Scheduler task `UlanziDevControlBridge` is running.
- Restart it manually: *Task Scheduler → UlanziDevControlBridge → Run*
- Or re-run the installer.

**Virtual cam not available in property inspector**
- Click **Start service** in the camera button's property inspector.
- The bridge will launch `main.py` as a fallback.
- If the problem persists, check that Python and `pyvirtualcam` are installed:
  ```
  python -m pip install pyvirtualcam opencv-python fastapi uvicorn pygrabber
  ```

**Camera not found / only "Unity Video Capture" listed**
- The Python service enumerates cameras via `pygrabber` (DirectShow) and excludes virtual devices.
- Ensure your webcam is connected before Ulanzi Studio starts.
- Click **Reload cameras** in the property inspector.

**Unity Video Capture not showing in Teams/Zoom**
- Re-register the DirectShow filter:
  ```
  regsvr32 "%APPDATA%\Ulanzi\UlanziDeck\Plugins\com.ulanzi.devcontrol.ulanziPlugin\native\webcam-mute\UnityCaptureFilter64.dll"
  ```
- Sign out and back in, or restart the conferencing app.

---

## Dependencies & Licenses

| Dependency | License |
|---|---|
| [Node.js](https://nodejs.org/) | MIT |
| [Python](https://python.org/) | PSF |
| [OpenCV (opencv-python)](https://github.com/opencv/opencv-python) | MIT |
| [pyvirtualcam](https://github.com/letmaik/pyvirtualcam) | MIT |
| [FastAPI](https://fastapi.tiangolo.com/) | MIT |
| [uvicorn](https://www.uvicorn.org/) | BSD |
| [pygrabber](https://github.com/bunkahle/pygrabber) | MIT |
| [Unity Capture](https://github.com/schellingb/UnityCapture) | MIT |
| Ulanzi Deck Plugin SDK | © Ulanzi Technology |

---

## Contributing

Pull requests are welcome. Please test on a clean Windows install before submitting.

---

## License

MIT – see [LICENSE](LICENSE) file.
