import { describe, expect, it } from 'vitest';
import { assessPhoto, issuesFrom, measurePixels } from './photoQuality';

function image(width: number, height: number, pixel: (x: number, y: number) => number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = pixel(x, y);
      data.set([value, value, value, 255], (y * width + x) * 4);
    }
  }
  return data;
}

describe('photo quality', () => {
  it('flags a dark, flat photo as dark and blurry', () => {
    expect(issuesFrom(measurePixels(image(32, 32, () => 30), 32, 32))).toEqual(['dark', 'blurry']);
  });

  it('accepts a bright photo with sharp detail', () => {
    const checker = image(32, 32, (x, y) => ((x >> 1) + (y >> 1)) % 2 ? 230 : 40);
    expect(issuesFrom(measurePixels(checker, 32, 32))).toEqual([]);
  });

  it('flags a bright but smooth photo as blurry only', () => {
    expect(issuesFrom(measurePixels(image(32, 32, x => 120 + x), 32, 32))).toEqual(['blurry']);
  });

  it('reports no issues when the browser cannot decode the photo', async () => {
    await expect(assessPhoto(new Blob(['not an image'], { type: 'image/jpeg' }))).resolves.toEqual([]);
  });
});
