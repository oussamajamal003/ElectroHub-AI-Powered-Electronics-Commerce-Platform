# About page media (Task 06.2)

Provenance: these files are re-encoded derivatives of the project's own unbranded studio photographs in `../catalog/`
(AI-generated for ElectroHub in Task 03.1, see `../README.md`). No stock, third-party or manufacturer imagery is used and
no new images were generated for this task. They depict product categories, not specific manufacturer models.

| File stem | Source |
| --- | --- |
| `laptop` | `catalog/laptops.jpg` |
| `laptop-closed` | `catalog/laptops-detail.jpg` |
| `headphones` | `catalog/headphones.jpg` |
| `smartwatch` | `catalog/smartwatches.jpg` |
| `smartphone` | `catalog/smartphones.jpg` |
| `monitor` | `catalog/monitors.jpg` |
| `tablet` | `catalog/tablets.jpg` |
| `console` | `catalog/gaming.jpg` |
| `charging-dock` | `catalog/accessories.jpg` |

Encoding (Pillow 12.3, Lanczos resize to 480 and 800 px square): AVIF quality 55 and WebP quality 80 (method 6).
The page serves them through `<picture>` (AVIF first, WebP fallback) with explicit `width`/`height`, `srcset`/`sizes`,
lazy loading below the fold and descriptive alt text. 36 files, about 385 KiB in total; a typical 800 px AVIF is about 15 KiB.
