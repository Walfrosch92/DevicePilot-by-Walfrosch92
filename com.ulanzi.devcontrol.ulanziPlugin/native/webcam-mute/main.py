"""
webcam-mute/main.py
===================
Captures a real webcam and forwards frames to a virtual camera (Unity Capture).
When muted, outputs a black frame instead of the real video.
Supports dynamic camera switching between two configured inputs.
Controlled via HTTP on localhost:5000 – called by the Ulanzi bridge (bridge.js).

Environment variables:
    CAMERA_NAME   – Partial name for auto-detection  (default: "Ulanzi D200")
    CAMERA_INDEX  – Force a specific camera index     (default: -1 = auto)
    API_PORT      – HTTP API port                     (default: 5000)
"""

import os
import sys
import time
import signal
import logging
import threading

import cv2
import numpy as np
import pyvirtualcam
from pyvirtualcam import PixelFormat
from pydantic import BaseModel
import uvicorn
from fastapi import FastAPI

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
CAMERA_NAME  = os.environ.get("CAMERA_NAME",  "Ulanzi D200")
CAMERA_INDEX = int(os.environ.get("CAMERA_INDEX", "-1"))   # -1 = auto-detect
API_PORT     = int(os.environ.get("API_PORT",  "5000"))
WIDTH, HEIGHT, FPS = 1280, 720, 30

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Shared state
# ---------------------------------------------------------------------------
muted: bool = False
running: bool = True
current_cam_index: int = -1
pending_cam_index: int | None = None

# ---------------------------------------------------------------------------
# HTTP control API (FastAPI)
# ---------------------------------------------------------------------------
api = FastAPI(title="Webcam Mute Controller", version="1.0.0")


@api.get("/status")
def get_status():
    return {"muted": muted, "cameraIndex": current_cam_index}


@api.post("/toggle")
def post_toggle():
    global muted
    muted = not muted
    log.info("Camera %s", "MUTED - black frame" if muted else "UNMUTED - live video")
    return {"muted": muted, "cameraIndex": current_cam_index}


@api.post("/mute")
def post_mute():
    global muted
    muted = True
    log.info("Camera MUTED - black frame")
    return {"muted": muted, "cameraIndex": current_cam_index}


@api.post("/unmute")
def post_unmute():
    global muted
    muted = False
    log.info("Camera UNMUTED - live video")
    return {"muted": muted, "cameraIndex": current_cam_index}


class SwitchRequest(BaseModel):
    index: int


@api.post("/switch")
def post_switch(req: SwitchRequest):
    global pending_cam_index
    pending_cam_index = req.index
    log.info("Camera switch queued: index %d", req.index)
    return {"switching": True, "index": req.index}


@api.get("/cameras")
def get_cameras():
    """List available physical cameras (excludes virtual cameras like Unity Capture)."""
    names = _list_camera_names()
    if names:
        return [
            {"index": i, "name": n}
            for i, n in enumerate(names)
            if "unity" not in n.lower()
        ]
    # pygrabber not available – scan indices
    result = []
    for i in range(10):
        cap = cv2.VideoCapture(i, cv2.CAP_DSHOW)
        if cap.isOpened():
            cap.release()
            result.append({"index": i, "name": f"Camera {i}"})
    return result


# ---------------------------------------------------------------------------
# Camera helpers
# ---------------------------------------------------------------------------
def _list_camera_names() -> list[str]:
    """Enumerate DirectShow device names via pygrabber (Windows). Returns [] if unavailable."""
    try:
        from pygrabber.dshow_graph import FilterGraph
        return FilterGraph().get_input_devices()
    except Exception:
        return []


def find_camera_index() -> int | None:
    """Find the camera by name; fall back to first available or index scan."""
    names = _list_camera_names()

    if names:
        for i, name in enumerate(names):
            if CAMERA_NAME.lower() in name.lower():
                log.info("Found '%s' at camera index %d", name, i)
                return i
        log.warning(
            "'%s' not found. Available: %s",
            CAMERA_NAME,
            ", ".join(f"[{i}] {n}" for i, n in enumerate(names)),
        )
        log.warning("Using first available camera: '%s' (index 0)", names[0])
        return 0

    # pygrabber not installed – brute-force scan
    log.warning("pygrabber not installed – scanning camera indices 0-9 ...")
    for i in range(10):
        cap = cv2.VideoCapture(i, cv2.CAP_DSHOW)
        if cap.isOpened():
            cap.release()
            log.info("Found camera at index %d", i)
            return i

    return None


def open_camera(index: int, exit_on_fail: bool = True) -> cv2.VideoCapture | None:
    """Open and configure the webcam. Retries first read up to 20x (2s) for slow cameras."""
    cap = cv2.VideoCapture(index, cv2.CAP_DSHOW)
    if not cap.isOpened():
        log.error("Cannot open camera at index %d.", index)
        if exit_on_fail:
            sys.exit(1)
        return None

    cap.set(cv2.CAP_PROP_FRAME_WIDTH,  WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, HEIGHT)
    cap.set(cv2.CAP_PROP_FPS,          FPS)

    ok = False
    for attempt in range(20):
        ok, _ = cap.read()
        if ok:
            break
        time.sleep(0.1)

    if not ok:
        log.error("Camera at index %d returned no frames after 2s.", index)
        cap.release()
        if exit_on_fail:
            sys.exit(1)
        return None

    log.info("Camera at index %d ready (attempt %d).", index, attempt + 1)
    return cap


# ---------------------------------------------------------------------------
# Camera / virtual-cam loop  (main thread)
# ---------------------------------------------------------------------------
def camera_loop() -> None:
    global running, current_cam_index, pending_cam_index

    idx = CAMERA_INDEX if CAMERA_INDEX >= 0 else find_camera_index()
    if idx is None:
        log.error("No webcam found. Exiting.")
        sys.exit(1)

    cap = open_camera(idx)
    current_cam_index = idx
    log.info("Camera connected (index %d, %dx%d @ %d fps)", idx, WIDTH, HEIGHT, FPS)

    # OpenCV delivers BGR (3-channel); pyvirtualcam 0.14+ uses PixelFormat.BGR
    black = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)

    with pyvirtualcam.Camera(
        width=WIDTH, height=HEIGHT, fps=FPS,
        fmt=PixelFormat.BGR,
        backend='unitycapture',   # requires UnityCaptureFilter64.dll registered via regsvr32
    ) as vcam:
        log.info("Virtual camera running: %s", vcam.device)
        log.info("Control API available on port %d", API_PORT)

        try:
            while running:
                # Handle pending camera switch between frames
                if pending_cam_index is not None and pending_cam_index != current_cam_index:
                    new_idx = pending_cam_index
                    pending_cam_index = None
                    new_cap = open_camera(new_idx, exit_on_fail=False)
                    if new_cap is not None:
                        cap.release()
                        cap = new_cap
                        current_cam_index = new_idx
                        log.info("Switched to camera index %d", new_idx)
                    else:
                        log.warning("Switch to index %d failed – keeping current camera.", new_idx)

                ok, frame = cap.read()

                if not ok:
                    log.warning("Frame read failed – sending black frame.")
                    vcam.send(black)
                    vcam.sleep_until_next_frame()
                    continue

                if frame.shape[1] != WIDTH or frame.shape[0] != HEIGHT:
                    frame = cv2.resize(frame, (WIDTH, HEIGHT))

                # BGR frame directly – no conversion needed
                out = black if muted else frame
                vcam.send(out)
                vcam.sleep_until_next_frame()

        finally:
            cap.release()
            log.info("Camera released.")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def main() -> None:
    global running

    def _shutdown(sig, _frame):
        global running
        log.info("Shutdown signal – stopping ...")
        running = False
        sys.exit(0)

    signal.signal(signal.SIGINT,  _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    # HTTP API runs on a daemon thread so it dies with the main thread
    api_thread = threading.Thread(
        target=lambda: uvicorn.run(
            api,
            host="127.0.0.1",
            port=API_PORT,
            log_level="warning",
        ),
        name="api-server",
        daemon=True,
    )
    api_thread.start()

    # Camera loop blocks the main thread
    camera_loop()


if __name__ == "__main__":
    main()
