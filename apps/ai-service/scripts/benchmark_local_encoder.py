"""Read-only CPU encoder diagnostic. No environment files, database, downloads or provider calls."""

from __future__ import annotations

import argparse
import json
import math
import platform
import statistics
import time
from pathlib import Path

from PIL import Image

from app.models.siglip_loader import load_siglip_encoder
from app.processors.image import ValidatedImage


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact-dir", type=Path, required=True)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    start = time.perf_counter()
    encoder = load_siglip_encoder(args.artifact_dir, torch_threads=2)
    startup_ms = (time.perf_counter() - start) * 1000
    try:
        with Image.open(args.image) as source:
            pixels = source.convert("RGB")
        image = ValidatedImage(content_type="image/jpeg", width=pixels.width, height=pixels.height, rgb=pixels)
        samples = []
        for _ in range(10):
            start = time.perf_counter()
            vector = encoder.encode(image)
            samples.append(round((time.perf_counter() - start) * 1000, 2))
            if len(vector) != 256 or abs(math.sqrt(sum(value * value for value in vector)) - 1) > 0.001:
                raise RuntimeError("Encoder output contract failed")
        result = {
            "scope": (
                "CPU encoder only; checksum validation and warmup included in startup; "
                "excludes relevance gate, HTTP and vector retrieval"
            ),
            "model": encoder.descriptor.model_version,
            "environment": {"os": platform.system(), "processor": platform.processor(), "torchThreads": 2},
            "startupMs": round(startup_ms, 2),
            "sampleCount": len(samples),
            "inferenceMs": samples,
            "medianMs": statistics.median(samples),
            "nearestRankP95Ms": sorted(samples)[math.ceil(len(samples) * 0.95) - 1],
            "assessment": "Diagnostic baseline; not an end-to-end image-search or deployment latency claim",
        }
        args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(result, indent=2))
    finally:
        encoder.close()


if __name__ == "__main__":
    main()
