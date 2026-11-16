"""Grid over gate threshold / gap / rerank weight for one encoded split (dev only; never the final benchmark)."""

from __future__ import annotations

import csv
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from evaluate_policy import metrics, results


def main(npz: str) -> None:
    data = np.load(npz)
    catalog_csv = Path("training/.data/kaggle-run2/dataset/manifests/catalog_products.csv")
    catalog = {r["product_id"]: r["appearance_family"] for r in csv.DictReader(catalog_csv.open(encoding="utf-8"))}
    print("minMass gap weight | catR1 catR5 famR1 famR5 prec unknownAccepted knownRejected meanShown")
    for min_mass in (0.0, 0.08, 0.2, 0.3, 0.4, 0.5, 0.6):
        for gap in (0.1, 0.15):
            for weight in (0.0, 0.5, 1.0):
                m = metrics(results(data, catalog, min_mass, gap, weight))
                print(
                    min_mass,
                    gap,
                    weight,
                    "|",
                    m["categoryRecall@1"],
                    m["categoryRecall@5"],
                    m["familyRecall@1"],
                    m["familyRecall@5"],
                    m["precisionOfShown"],
                    m["unknownAccepted"],
                    m["knownRejected"],
                    m["meanShown"],
                )


if __name__ == "__main__":
    main(sys.argv[1])
