#!/usr/bin/env python3
"""
Convert MP4 source videos to transparent animated WebP for the Samoyed pet app.

This script removes the greenish-yellow studio background from AI-generated
videos by detecting pixels where green dominates blue (the background is
yellow-green, while the dog is white/cream). It then saves the result as an
animated WebP with an alpha channel.

Usage:
    python scripts/convert_videos.py

Requirements:
    - ffmpeg with libwebp support
    - Python packages: Pillow, numpy, scipy

Adjust WIDTH, FPS, QUALITY and the green/blue thresholds below if needed.
"""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent.parent
ASSETS_DIR = PROJECT_ROOT / "assets"
ANIM_DIR = PROJECT_ROOT / "anim"

# Output size. The app's anim-wrap is 340x340 CSS pixels, so 480 px is plenty
# even for HiDPI displays. Set to -1 to keep the original width.
WIDTH = 480

# Output frame rate. Source videos are 60 fps; 30 fps keeps motion smooth and
# halves the file size.
FPS = 30

# libwebp quality (0-100). Higher = better visual quality, larger file.
QUALITY = 82

# Background removal thresholds based on (G - B).
#   gb > HIGH   -> fully transparent
#   gb < LOW    -> fully opaque
#   in between  -> soft alpha blend
GB_THRESHOLD_LOW = 12
GB_THRESHOLD_HIGH = 42

# Video filename -> output WebP name. Add new videos here.
VIDEO_MAP: dict[str, str] = {
    "idle.mp4": "idle.webp",
    "walk.mp4": "walk.webp",
    "jump.mp4": "jump.webp",
    "sitDown.mp4": "sit.webp",
    "happyDance.mp4": "happy.webp",
    "pawWave.mp4": "pawWave.webp",
    "headTilt.mp4": "headTilt.webp",
    "tailWagFast.mp4": "tailWagFast.webp",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def run(cmd: list[str | Path], check: bool = True) -> subprocess.CompletedProcess[str]:
    """Run a command and return the result."""
    return subprocess.run(
        [str(c) for c in cmd],
        check=check,
        capture_output=True,
        text=True,
    )


def extract_frames(video_path: Path, frames_dir: Path, fps: int, width: int) -> None:
    """Extract a PNG sequence from an MP4 with ffmpeg."""
    frames_dir.mkdir(parents=True, exist_ok=True)

    # Clean any existing frames in the temp directory.
    for existing in frames_dir.glob("*.png"):
        existing.unlink()

    scale = f"scale={width}:-1:flags=lanczos" if width > 0 else ""
    vf = f"fps={fps},{scale}" if scale else f"fps={fps}"

    run([
        "ffmpeg",
        "-y",
        "-i", video_path,
        "-vf", vf,
        "-pix_fmt", "rgba",
        frames_dir / "%04d.png",
    ])


def remove_background(src_path: Path, dst_path: Path) -> None:
    """Remove the greenish-yellow background from a single PNG frame."""
    img = Image.open(src_path).convert("RGBA")
    arr = np.array(img, dtype=np.int16)

    r = arr[:, :, 0]
    g = arr[:, :, 1]
    b = arr[:, :, 2]

    # The background is yellow-green: green is much higher than blue.
    # White/cream fur has R >= G or G only slightly above B, so it stays opaque.
    gb = g - b

    span = GB_THRESHOLD_HIGH - GB_THRESHOLD_LOW
    alpha = np.clip(
        (GB_THRESHOLD_HIGH - gb) * 255 / span, 0, 255
    ).astype(np.uint8)

    # Fill tiny holes inside the foreground silhouette (e.g. eye glints,
    # compression artifacts) so the dog doesn't flicker.
    fg_mask = alpha > 128
    fg_filled = ndimage.binary_fill_holes(fg_mask)
    alpha[fg_filled & (alpha < 128)] = 255

    arr[:, :, 3] = alpha
    Image.fromarray(arr.astype(np.uint8)).save(dst_path)


def encode_webp(frames_dir: Path, output_path: Path, fps: int, quality: int) -> None:
    """Encode a PNG sequence into an animated WebP with alpha using img2webp."""
    frame_ms = max(1, round(1000 / fps))
    frames = sorted(frames_dir.glob("*.png"))
    if not frames:
        raise RuntimeError(f"no frames found in {frames_dir}")

    cmd: list[str | Path] = [
        "img2webp",
        "-loop", "0",
        "-mixed",
        "-q", quality,
    ]
    for frame in frames:
        cmd.extend(["-d", frame_ms, frame])
    cmd.extend(["-o", output_path])

    run(cmd)


def process_video(video_name: str, output_name: str) -> None:
    video_path = ASSETS_DIR / video_name
    output_path = ANIM_DIR / output_name

    if not video_path.exists():
        print(f"  skip {video_name} (not found)")
        return

    print(f"processing {video_name} -> {output_name}")

    with tempfile.TemporaryDirectory(prefix="samoyed_") as tmp:
        tmp_path = Path(tmp)
        raw_dir = tmp_path / "raw"
        clean_dir = tmp_path / "clean"
        raw_dir.mkdir()
        clean_dir.mkdir()

        extract_frames(video_path, raw_dir, FPS, WIDTH)

        for frame in sorted(raw_dir.glob("*.png")):
            remove_background(frame, clean_dir / frame.name)

        encode_webp(clean_dir, output_path, FPS, QUALITY)

    size_kb = output_path.stat().st_size / 1024
    print(f"  wrote {output_path} ({size_kb:.1f} KB)")


def main() -> None:
    ANIM_DIR.mkdir(parents=True, exist_ok=True)

    # Verify ffmpeg has libwebp.
    try:
        info = run(["ffmpeg", "-version"], check=True).stdout
        if "libwebp" not in info:
            raise RuntimeError("ffmpeg was not built with libwebp support")
    except Exception as exc:  # noqa: BLE001
        print(f"ffmpeg check failed: {exc}")
        raise SystemExit(1) from exc

    for video_name, output_name in VIDEO_MAP.items():
        process_video(video_name, output_name)

    print("done")


if __name__ == "__main__":
    main()
