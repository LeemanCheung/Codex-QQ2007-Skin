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
QQ_STAGE_SIZE = (390, 320)


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


def make_qq_stage_background(width: int, height: int) -> Image.Image:
    """Create a full-bleed wide background matching the narrow friend pane."""

    background = Image.new("RGB", (width, height))
    pixels = background.load()
    for y in range(height):
        ratio = y / max(1, height - 1)
        for x in range(width):
            texture = 1 if (x + y) % 7 == 0 else 0
            pixels[x, y] = (
                round(232 - 35 * ratio) + texture,
                round(246 - 24 * ratio) + texture,
                255,
            )
    draw = ImageDraw.Draw(background)
    star_color = (251, 252, 242)
    scale = min(width / 468, height / 384)
    for x_ratio, y_ratio, outer in (
        (0.09, 0.13, 17),
        (0.85, 0.10, 13),
        (0.89, 0.73, 16),
        (0.14, 0.84, 12),
    ):
        radius = max(5, round(outer * scale))
        draw.polygon(
            star_points(round(width * x_ratio), round(height * y_ratio), radius, max(2, radius // 2)),
            fill=star_color,
        )
    circle_size = max(23, round(57 * scale))
    for center_x, center_y in ((0.08, 0.71), (0.91, 0.29)):
        x = round(width * center_x)
        y = round(height * center_y)
        box = (
            x - circle_size // 2,
            y - circle_size // 2,
            x + circle_size // 2,
            y + circle_size // 2,
        )
        draw.ellipse(box, outline=(242, 251, 255), width=2)
    return background


def make_qq_stage_frame(frame: Image.Image) -> Image.Image:
    """Keep the mascot square and centered while extending only its backdrop."""

    width, height = QQ_STAGE_SIZE
    square = frame.resize((height, height), Image.Resampling.NEAREST)
    mask = subject_mask(frame).resize((height, height), Image.Resampling.NEAREST)
    stage = make_qq_stage_background(width, height)
    stage.paste(square, ((width - height) // 2, 0), mask)
    return stage


def facial_anchor_x(frame: Image.Image, mask: Image.Image) -> float:
    """Use the upper orange beak as a stable horizontal body anchor."""

    box = mask.getbbox()
    if not box:
        return frame.width / 2
    cutoff = box[1] + round((box[3] - box[1]) * 0.65)
    orange_x: list[int] = []
    pixels = frame.load()
    for y in range(box[1], cutoff):
        for x in range(frame.width):
            red, green, blue = pixels[x, y]
            if red > 160 and 55 < green < 190 and blue < 70 and red > green * 1.15:
                orange_x.append(x)
    return sum(orange_x) / len(orange_x) if orange_x else (box[0] + box[2]) / 2


def stabilize_keyframes(
    frames: list[Image.Image],
    horizontal_scale: float = 1.0,
    align_face: bool = False,
) -> list[Image.Image]:
    background = make_background(OUTPUT_SIZE)
    masks = [subject_mask(frame) for frame in frames]
    if horizontal_scale != 1.0:
        scaled_frames: list[Image.Image] = []
        scaled_masks: list[Image.Image] = []
        scaled_width = round(OUTPUT_SIZE * horizontal_scale)
        left = (OUTPUT_SIZE - scaled_width) // 2
        for frame, mask in zip(frames, masks):
            scaled_frame = Image.new("RGB", frame.size)
            scaled_mask = Image.new("L", mask.size)
            scaled_frame.paste(frame.resize((scaled_width, OUTPUT_SIZE), Image.Resampling.LANCZOS), (left, 0))
            scaled_mask.paste(mask.resize((scaled_width, OUTPUT_SIZE), Image.Resampling.LANCZOS), (left, 0))
            scaled_frames.append(scaled_frame)
            scaled_masks.append(scaled_mask)
        frames, masks = scaled_frames, scaled_masks
    reference_box = masks[0].getbbox()
    reference_baseline = reference_box[3] if reference_box else OUTPUT_SIZE
    reference_anchor_x = facial_anchor_x(frames[0], masks[0]) if align_face else None
    stabilized: list[Image.Image] = []
    for frame, mask in zip(frames, masks):
        box = mask.getbbox()
        vertical_offset = reference_baseline - box[3] if box else 0
        horizontal_offset = round(reference_anchor_x - facial_anchor_x(frame, mask)) if align_face else 0
        shifted_frame = Image.new("RGB", frame.size)
        shifted_mask = Image.new("L", mask.size)
        shifted_frame.paste(frame, (horizontal_offset, vertical_offset))
        shifted_mask.paste(mask, (horizontal_offset, vertical_offset))
        stabilized.append(Image.composite(shifted_frame, background, shifted_mask))
    return stabilized


def quantize_frames(frames: list[Image.Image]) -> list[Image.Image]:
    palette = frames[0].convert("P", palette=Image.Palette.ADAPTIVE, colors=128)
    return [
        frame.convert("RGB").quantize(palette=palette, dither=Image.Dither.FLOYDSTEINBERG)
        for frame in frames
    ]


def validate_qq_proportions(frames: list[Image.Image]) -> None:
    boxes = [subject_mask(frame).getbbox() for frame in frames]
    if any(box is None for box in boxes):
        raise ValueError("QQ keyframe subject could not be measured")
    neutral = boxes[0]
    neutral_ratio = (neutral[2] - neutral[0]) / (neutral[3] - neutral[1])
    if not 0.82 <= neutral_ratio <= 0.92:
        raise ValueError(f"QQ neutral-frame width/height ratio drifted to {neutral_ratio:.3f}")
    baselines = [box[3] for box in boxes]
    if max(baselines) - min(baselines) > 1:
        raise ValueError(f"QQ keyframe baselines drifted: {baselines}")
    anchors = [facial_anchor_x(frame, subject_mask(frame)) for frame in frames]
    if max(anchors) - min(anchors) > 1:
        raise ValueError(f"QQ keyframe horizontal anchors drifted: {anchors}")


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
    keyframes = stabilize_keyframes(
        crop_sprite_sheet(ASSETS / "qq-retro-wave-sprites.png"),
        horizontal_scale=0.90,
        align_face=True,
    )
    validate_qq_proportions(keyframes)
    stage_frames = [make_qq_stage_frame(frame) for frame in keyframes]
    # The reduced-motion fallback must be the exact neutral frame from the
    # animated character, not a separately generated pose with different body
    # proportions or facial geometry.
    stage_frames[0].save(ASSETS / "qq-retro-stage.png", format="PNG", optimize=True)
    # Neutral -> wave high -> neutral -> wave low + blink -> return -> neutral.
    order = (0, 1, 0, 2, 3, 0)
    durations = [320, 160, 90, 150, 170, 300]
    destination = ASSETS / "qq-retro-stage.gif"
    save_gif([stage_frames[index] for index in order], durations, destination)
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
