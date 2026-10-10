"""Align adapter (CTC, wav2vec2 ONNX): drives the vendored analysis/align_vo.py and audio_vo.py unchanged.

    uv run python align.py <audio> <lines.json> <run_dir> <model.onnx>

lines.json: {"lines": [{"text": ...}, ...], "spoken_words"?: {"5.5.": ["FIVE", "POINT", "FIVE"], ...}}
  spoken_words maps a display word to what is said (align_vo's SPOKEN); words not in it are read as written.
Writes <run_dir>/data/timing.json (word times, the aligner's word-timed format) and <run_dir>/data/audio.json
(voice envelopes, word onsets, nominal beat grid). Prints the timing.json path.
"""

import json
import sys
import tempfile
from pathlib import Path

ANALYSIS = Path(__file__).resolve().parent / "analysis"
sys.path.insert(0, str(ANALYSIS))
import align_vo  # module-level paths are overridden below; VOCAB stays in analysis/models, MODEL comes from <vmHome>/models


def main(audio: Path, lines_file: Path, run_dir: Path, model: Path) -> Path:
    spec = json.loads(lines_file.read_text(encoding="utf-8"))
    texts = [line["text"] for line in spec["lines"]]
    if not texts:
        sys.exit("align: no lines")
    data = run_dir / "data"
    data.mkdir(parents=True, exist_ok=True)
    timing, audio_json = data / "timing.json", data / "audio.json"

    # align_vo.main() reads these module globals at call time and writes ROOT/data/lyrics.json
    with tempfile.TemporaryDirectory() as tmp:
        align_vo.ROOT, align_vo.AUDIO = Path(tmp), audio
        align_vo.SCRIPT, align_vo.SPOKEN = texts, spec.get("spoken_words", {})
        align_vo.MODEL = model
        (Path(tmp) / "data").mkdir()
        align_vo.main()
        timing.write_text((Path(tmp) / "data" / "lyrics.json").read_text(encoding="utf-8"), encoding="utf-8")

    # audio_vo.py is a flat script with fixed paths: run its source with those paths swapped in.
    # ponytail: text swap of three path expressions; asserts fail loudly if the script changes
    src = (ANALYSIS / "audio_vo.py").read_text(encoding="utf-8")
    for old, new in [
        ('ROOT / "audio" / "voiceover.mp3"', "_AUDIO"),
        ('ROOT / "data" / "lyrics.json"', "_TIMING"),
        ('ROOT / "data" / "audio.json"', "_OUT"),
    ]:
        assert old in src, f"audio_vo.py changed: {old!r} not found"
        src = src.replace(old, new)
    exec(
        compile(src, str(ANALYSIS / "audio_vo.py"), "exec"),
        {
            "__name__": "__main__",
            "__file__": str(ANALYSIS / "audio_vo.py"),
            "_AUDIO": audio,
            "_TIMING": timing,
            "_OUT": audio_json,
        },
    )
    return timing


if __name__ == "__main__":
    if len(sys.argv) != 5:
        sys.exit(__doc__)
    print(main(*(Path(a).resolve() for a in sys.argv[1:5])))
