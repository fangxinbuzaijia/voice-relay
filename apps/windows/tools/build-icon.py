from pathlib import Path

from PIL import Image, ImageDraw


def build_icon(output: Path) -> None:
    scale = 4
    size = 256
    canvas = Image.new("RGBA", (size * scale, size * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    def box(values: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
        return tuple(value * scale for value in values)

    draw.rounded_rectangle(box((0, 0, 256, 256)), radius=48 * scale, fill="#171A1F")
    draw.rectangle(box((60, 85, 145, 114)), fill="#F7F5EF")
    draw.rectangle(box((60, 142, 196, 171)), fill="#F7F5EF")
    draw.polygon([(155 * scale, 70 * scale), (201 * scale, 99 * scale), (155 * scale, 128 * scale)], fill="#247A52")

    icon = canvas.resize((size, size), Image.Resampling.LANCZOS)
    output.parent.mkdir(parents=True, exist_ok=True)
    icon.save(
        output,
        format="ICO",
        sizes=[(16, 16), (20, 20), (24, 24), (32, 32), (40, 40), (48, 48), (64, 64), (128, 128), (256, 256)],
    )


if __name__ == "__main__":
    build_icon(Path(__file__).resolve().parents[1] / "VoiceRelay.Windows" / "Assets" / "VoiceRelay.ico")
