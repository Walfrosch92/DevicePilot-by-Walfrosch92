# Device Pilot – Ulanzi Deck Plugin

One-tap system-wide control over **audio output**, **microphone**, and **virtual camera** for the Ulanzi Stream Controller (D200 and compatible) on Windows.

---

## Features

| Button | Available Actions |
|---|---|
| **Audio Output** | Set as default · Toggle mute · Toggle between 2 devices |
| **Microphone** | Toggle mute · Set as default · Toggle between 2 devices |
| **Camera** | Mute / unmute virtual cam (black frame ↔ live) · Switch between 2 physical cameras |

- Button icons update live to reflect the current state
- Toast notification on every action
- No admin rights required, only for install

---

## How the camera button works

The camera button does **not** use the Windows Device Manager to enable or disable a physical camera. Instead it runs a small Python service (`main.py`) that:

1. Opens a physical webcam with OpenCV
2. Forwards every frame to a **Unity Capture** virtual DirectShow device via `pyvirtualcam`

**Muted** → the service sends a plain black frame instead of the real video feed
**Switching** → swaps to a different physical camera between frames (no restart needed)

The virtual device appears as **"Unity Video Capture"** in any video conferencing app (Teams, Zoom, OBS, etc.). Your physical webcam is **never disabled** — only the forwarded image is controlled.

### First-time setup in your video conferencing app

*Settings → Camera → select **Unity Video Capture***

---

## Requirements

| Component | Minimum version |
|---|---|
| Windows | 10 / 11 (x64) |
| Ulanzi Studio |
| Node.js | 18 LTS or newer |
| Python | 3.10 or newer |

The installer handles all missing dependencies automatically.

---

## Installation

1. Download or clone this repository.
2. Open the downloaded Folder and start "Installieren.bat" 

The installer will automatically:
- Install Node.js (via winget or direct download) if missing
- Install Python (via winget) if missing
- Copy the plugin to `%APPDATA%\Ulanzi\UlanziDeck\Plugins\`
- Install Python packages: `opencv-python`, `pyvirtualcam`, `fastapi`, `uvicorn`, `pygrabber`
- Download and register the **Unity Capture** DirectShow filter (MIT license, ~500 KB)
- Register two autostart services in Windows Task Scheduler (no admin, user-level):
  - `UlanziDevControlBridge` – Node.js HTTP bridge on port 3907
  - `UlanziVirtualCamService` – Python virtual cam service on port 5000
- Start both services immediately

3. Restart your System after the script finished
4. Start **Ulanzi Studio** — the *Device Pilot* plugin appears in the action list.

---

## Uninstallation

1. Go to `%APPDATA%\Ulanzi\UlanziDeck\Plugins\com.ulanzi.devcontrol.ulanziPlugin` and start "Deinstallieren.bat"
2. After the script finishes, please restart your System

Removes both Task Scheduler tasks, stops all services, unregisters the Unity Capture DirectShow filter, and deletes the plugin folder.

---

## Architecture

```
Ulanzi Studio
  └── plugin.js            (Node.js, Ulanzi SDK via WebSocket)
        └── HTTP → bridge.js  (Node.js, port 3907)
                    ├── AudioControl.js    (COM: IPolicyConfig + IAudioEndpointVolume)
                    ├── CameraControl.js   (DirectShow enumeration – list only)
                    └── HTTP → main.py     (Python, port 5000)
                                ├── OpenCV  – reads physical webcam
                                └── pyvirtualcam → Unity Capture DirectShow filter
```

### Background services

| Service | Port | Technology | Purpose |
|---|---|---|---|
| `UlanziDevControlBridge` | 3907 | Node.js | Audio COM calls, camera enumeration |
| `UlanziVirtualCamService` | 5000 | Python / FastAPI | Webcam capture → virtual cam output |

Both services start automatically at Windows login (Task Scheduler, `RunLevel Limited` – no admin needed).

---

## Button configuration

### Audio Output

| Mode | What it does |
|---|---|
| Set as Default | Makes the selected device the system default output |
| Toggle Mute | Mutes / unmutes the current default output device |
| Toggle Between 2 Devices | Alternates between Device 1 and Device 2 on each press |

### Microphone

Same three modes as Audio Output, applied to recording (input) devices.

### Camera

| Mode | What it does |
|---|---|
| Toggle Mute / Live | Sends a black frame (muted) or the real webcam image (live) to the virtual cam |
| Switch Camera | Alternates between Camera 1 and Camera 2 on each press |

Camera dropdowns are populated automatically from all connected physical cameras when the property inspector is open (virtual devices like Unity Video Capture are excluded from the list).

---

## Troubleshooting

**"Bridge not ready" on button press**
- Check that the Task Scheduler task `UlanziDevControlBridge` is running.
- Restart it: *Task Scheduler → UlanziDevControlBridge → Run*
- Or simply re-run the installer.

**Camera property inspector shows "Virtual cam service not available"**
- Click **Start service** — the bridge will launch `main.py` as a fallback.
- Make sure you restarted your System after installation.
- If it still fails, check that Python and all packages are installed:
  ```
  python -m pip install pyvirtualcam opencv-python fastapi uvicorn pygrabber
  ```

**Camera list is empty or only shows "Unity Video Capture"**
- Make sure your webcam is connected before opening the property inspector.
- Click **Reload cameras** to re-enumerate.
- Make sure you restarted your System after installation.

**"Unity Video Capture" not showing in Teams / Zoom**
- Re-register the DirectShow filter as Administrator:
  ```
  regsvr32 "%APPDATA%\Ulanzi\UlanziDeck\Plugins\com.ulanzi.devcontrol.ulanziPlugin\native\webcam-mute\UnityCaptureFilter64.dll"
  ```
- Restart the conferencing app.

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
