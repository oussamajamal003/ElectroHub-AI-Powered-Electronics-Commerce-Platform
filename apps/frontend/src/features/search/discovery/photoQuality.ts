/**
 * Task 04.2-Q: local capture-quality check, run only after a photo search finds no match, so the empty state can say
 * why a retake may help. Nothing is uploaded; the photo is measured on a small canvas in the browser.
 *
 * Thresholds come from the training photos (160 px, 0–255 luma): 5% of real product photos have a mean luma below
 * 45 and a Laplacian variance below 354, while the simulated dark/blurred mouse captures fall at 38–67 and 21–246.
 */
export type PhotoIssue = 'dark' | 'blurry';

export const DARK_LUMA = 70;
export const BLURRY_VARIANCE = 300;
const SIDE = 160;

/** Mean luma and Laplacian variance of an RGBA pixel buffer. */
export function measurePixels(data: Uint8ClampedArray, width: number, height: number): { luma: number; sharpness: number } {
  const y = new Float32Array(width * height);
  let total = 0;
  for (let i = 0; i < y.length; i += 1) {
    const r = data[i * 4] ?? 0;
    const g = data[i * 4 + 1] ?? 0;
    const b = data[i * 4 + 2] ?? 0;
    const val = 0.299 * r + 0.587 * g + 0.114 * b;
    y[i] = val;
    total += val;
  }
  let sum = 0;
  let squares = 0;
  let count = 0;
  for (let row = 1; row < height - 1; row += 1) {
    for (let col = 1; col < width - 1; col += 1) {
      const i = row * width + col;
      const cur = y[i] ?? 0;
      const left = y[i - 1] ?? 0;
      const right = y[i + 1] ?? 0;
      const top = y[i - width] ?? 0;
      const bottom = y[i + width] ?? 0;
      const laplacian = 4 * cur - left - right - top - bottom;
      sum += laplacian;
      squares += laplacian * laplacian;
      count += 1;
    }
  }
  const mean = count ? sum / count : 0;
  return { luma: y.length ? total / y.length : 0, sharpness: count ? squares / count - mean * mean : 0 };
}

export function issuesFrom({ luma, sharpness }: { luma: number; sharpness: number }): PhotoIssue[] {
  const issues: PhotoIssue[] = [];
  if (luma < DARK_LUMA) issues.push('dark');
  if (sharpness < BLURRY_VARIANCE) issues.push('blurry');
  return issues;
}

/** Best effort: returns no issues when the browser cannot decode or draw the photo. */
export async function assessPhoto(file: Blob): Promise<PhotoIssue[]> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(3, Math.round(bitmap.width * scale));
    const height = Math.max(3, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return [];
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    return issuesFrom(measurePixels(context.getImageData(0, 0, width, height).data, width, height));
  } catch {
    return [];
  }
}
