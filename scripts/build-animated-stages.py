#!/usr/bin/env python3
"""Build lightweight idle-loop GIFs from generated, crop-ready keyframes."""

from __future__ import annotations

import math
from collections import deque
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
OUTPUT_SIZE = 384


def crop_sprite_sheet(path: Path) -> list[Image.Image]:
    """Split a strict 2x2 sheet into four equal, seam-free square cells."""

    sheet = Image.open(path).convert("RGB")
    half_width = sheet.width // 2
    half_height = sheet.height // 2
    frames: list[Image.Image] = []
    for row in range(2):
        for column in range(2):
            inset = 2
            left = column * half_width + inset
            top = row * half_height + inset
            right = (column + 1) * half_width - inset
            bottom = (row + 1) * half_height - inset
            frame = sheet.crop((left, top, right, bottom)).resize(
                (OUTPUT_SIZE, OUTPUT_SIZE),
                Image.Resampling.LANCZOS,
            )
            frames.append(frame)
    return frames


def largest_component(mask: Image.Image) -> Image.Image:
    """Keep the central connected subject and discard background texture."""

    width, height = mask.size
    pixels = bytearray(mask.tobytes())
    visited = bytearray(width * height)
    largest: list[int] = []
    for start, value in enumerate(pixels):
        if value == 0 or visited[start]:
            continue
        queue = deque([start])
        visited[start] = 1
        component: list[int] = []
        while queue:
            index = queue.popleft()
            component.append(index)
            x = index % width
            y = index // width
            if x > 0:
                neighbor = index - 1
                if pixels[neighbor] and not visited[neighbor]:
                    visited[neighbor] = 1
                    queue.append(neighbor)
            if x + 1 < width:
                neighbor = index + 1
                if pixels[neighbor] and not visited[neighbor]:
                    visited[neighbor] = 1
                    queue.append(neighbor)
            if y > 0:
                neighbor = index - width
                if pixels[neighbor] and not visited[neighbor]:
                    visited[neighbor] = 1
                    queue.append(neighbor)
            if y + 1 < height:
                neighbor = index + width
                if pixels[neighbor] and not visited[neighbor]:
                    visited[neighbor] = 1
                    queue.append(neighbor)
        if len(component) > len(largest):
            largest = component
    result = bytearray(width * height)
    for index in largest:
        result[index] = 255
    return Image.frombytes("L", (width, height), bytes(result))


def subject_mask(frame: Image.Image) -> Image.Image:
    """Extract the dark/saturated mascot, then fill its enclosed light areas."""

    source = frame.convert("RGB")
    candidate = Image.new("L", source.size, 0)
    output = candidate.load()
    pixels = source.load()
    for y in range(source.height):
        for x in range(source.width):
            red, green, blue = pixels[x, y]
            pale_background = red > 145 and green > 165 and blue > 178
            if not pale_background:
                output[x, y] = 255
    candidate = candidate.filter(ImageFilter.MaxFilter(5))
    component = largest_component(candidate)
    # Flood the exterior, then convert enclosed holes (eyes, belly, glyphs) to
    # foreground so their light colors remain part of the mascot.
    flooded = component.copy()
    ImageDraw.floodfill(flooded, (0, 0), 128, thresh=0)
    component_data = bytearray(component.tobytes())
    flooded_data = bytearray(flooded.tobytes())
    filled = bytes(
        255 if original == 255 or flood_value == 0 else 0
        for original, flood_value in zip(component_data, flooded_data)
    )
    return Image.frombytes("L", source.size, filled).filter(ImageFilter.GaussianBlur(0.55))


def star_points(center_x: int, center_y: int, outer: int, inner: int) -> list[tuple[int, int]]:
    points = []
    for index in range(10):
        radius = outer if index % 2 == 0 else inner
        angle = -math.pi / 2 + index * math.pi / 5
        points.append((round(center_x + math.cos(angle) * radius), round(center_y + math.sin(angle) * radius)))
    return points


def make_background(size: int) -> Image.Image:
    """Create one stable QQ2007-style background shared by every keyframe."""

    background = Image.new("RGB", (size, size))
    pixels = background.load()
    for y in range(size):
        ratio = y / max(1, size - 1)
        for x in range(size):
            texture = 1 if (x + y) % 7 == 0 else 0
            pixels[x, y] = (
                round(232 - 35 * ratio) + texture,
                round(246 - 24 * ratio) + texture,
                255,
            )
    draw = ImageDraw.Draw(background)
    star_color = (251, 252, 242)
    for x, y, outer in ((44, 52, 17), (327, 42, 13), (343, 280, 16), (63, 322, 12)):
        draw.polygon(star_points(x, y, outer, max(4, outer // 2)), fill=star_color)
    for box in ((18, 245, 75, 302), (312, 83, 369, 140)):
        draw.ellipse(box, outline=(242, 251, 255), width=4)
        inset = 7
        draw.arc(
            (box[0] + inset, box[1] + inset, box[2] - inset, box[3] - inset),
            205,
            320,
            fill=(213, 241, 255),
            width=2,
        )
    return background


def stabilize_keyframes(frames: list[Image.Image]) -> list[Image.Image]:
    background = make_background(OUTPUT_SIZE)
    stabilized: list[Image.Image] = []
    for frame in frames:
        mask = subject_mask(frame)
        stabilized.append(Image.composite(frame, background, mask))
    return stabilized


def quantize_frames(frames: list[Image.Image]) -> list[Image.Image]:
    palette = frames[0].convert("P", palette=Image.Palette.ADAPTIVE, colors=128)
    return [
        frame.convert("RGB").quantize(palette=palette, dither=Image.Dither.FLOYDSTEINBERG)
        for frame in frames
    ]


def save_gif(frames: list[Image.Image], durations: list[int], destination: Path) -> None:
    quantized = quantize_frames(frames)
    quantized[0].save(
        destination,
        format="GIF",
        save_all=True,
        append_images=quantized[1:],
        duration=durations,
        loop=0,
        optimize=True,
        disposal=2,
        comment=b"Generated from project-owned animation keyframes",
    )


def build_codex_animation() -> Path:
    keyframes = stabilize_keyframes(crop_sprite_sheet(ASSETS / "codex2007-bot-typing-sprites.png"))
    # Neutral -> left press -> neutral -> right press -> ready -> neutral.
    order = (0, 1, 0, 2, 3, 0)
    durations = [260, 130, 90, 130, 150, 230]
    destination = ASSETS / "codex2007-bot-stage.gif"
    save_gif([keyframes[index] for index in order], durations, destination)
    return destination


def build_qq_animation() -> Path:
    keyframes = stabilize_keyframes(crop_sprite_sheet(ASSETS / "qq-retro-wave-sprites.png"))
    # Neutral -> wave high -> neutral -> wave low + blink -> return -> neutral.
    order = (0, 1, 0, 2, 3, 0)
    durations = [320, 160, 90, 150, 170, 300]
    destination = ASSETS / "qq-retro-stage.gif"
    save_gif([keyframes[index] for index in order], durations, destination)
    return destination


def main() -> None:
    outputs = (build_codex_animation(), build_qq_animation())
    for output in outputs:
        with Image.open(output) as animation:
            print(
                f"{output.relative_to(ROOT)}: {animation.size[0]}x{animation.size[1]}, "
                f"{animation.n_frames} frames, {output.stat().st_size} bytes"
            )


if __name__ == "__main__":
    main()
