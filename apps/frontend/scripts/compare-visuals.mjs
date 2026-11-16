import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIGMA_CUSTOMER_DIR = path.resolve(__dirname, '../../../docs/assets/figma/exports/customer/screenshots');
const FIGMA_ADMIN_DIR = path.resolve(__dirname, '../../../docs/assets/figma/exports/admin/screenshots');
const ACTUAL_DIR = path.resolve(__dirname, '../screenshots/actual');
const DIFF_DIR = path.resolve(__dirname, '../screenshots/diff');

if (!fs.existsSync(DIFF_DIR)) {
  fs.mkdirSync(DIFF_DIR, { recursive: true });
}

const comparisons = [
  {
    name: 'Customer Header',
    figma: path.join(FIGMA_CUSTOMER_DIR, 'Home page.png'),
    actual: path.join(ACTUAL_DIR, 'customer-header.png'),
    diff: path.join(DIFF_DIR, 'customer-header-diff.png'),
    notes: 'Compares top 80px Header element only (excluding Hero section)'
  },
  {
    name: 'Customer Login',
    figma: path.join(FIGMA_CUSTOMER_DIR, 'login.png'),
    actual: path.join(ACTUAL_DIR, 'customer-login.png'),
    diff: path.join(DIFF_DIR, 'customer-login-diff.png'),
    notes: 'Compares Customer Login Modal against Figma login frame'
  },
  {
    name: 'Customer Register',
    figma: path.join(FIGMA_CUSTOMER_DIR, 'Register.png'),
    actual: path.join(ACTUAL_DIR, 'customer-register.png'),
    diff: path.join(DIFF_DIR, 'customer-register-diff.png'),
    notes: 'Compares Customer Register Modal against Figma Register frame'
  },
  {
    name: 'Admin Login',
    figma: path.join(FIGMA_ADMIN_DIR, 'Admin login.png'),
    actual: path.join(ACTUAL_DIR, 'admin-login.png'),
    diff: path.join(DIFF_DIR, 'admin-login-diff.png'),
    notes: 'Compares Admin Login Page against Figma Admin login frame'
  }
];

let hasErrors = false;
const results = [];

console.log('====================================================');
console.log('Starting Strict Component-Level Visual Comparison...');
console.log('====================================================\n');

for (const comp of comparisons) {
  console.log(`[${comp.name}] Comparing...`);
  if (!fs.existsSync(comp.figma)) {
    console.error(`  ❌ Missing Figma reference: ${comp.figma}`);
    hasErrors = true;
    continue;
  }
  if (!fs.existsSync(comp.actual)) {
    console.error(`  ❌ Missing actual screenshot: ${comp.actual}`);
    hasErrors = true;
    continue;
  }

  const img1 = PNG.sync.read(fs.readFileSync(comp.figma));
  const img2 = PNG.sync.read(fs.readFileSync(comp.actual));

  const width = Math.min(img1.width, img2.width);
  const height = Math.min(img1.height, img2.height);

  console.log(`  Reference dimensions: ${img1.width} x ${img1.height}`);
  console.log(`  Actual dimensions: ${img2.width} x ${img2.height}`);
  console.log(`  Comparison region: ${width} x ${height} (${comp.notes})`);

  const img1Cropped = new PNG({ width, height });
  const img2Cropped = new PNG({ width, height });
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) << 2;
      const idx1 = (img1.width * y + x) << 2;
      const idx2 = (img2.width * y + x) << 2;
      
      img1Cropped.data[idx] = img1.data[idx1];
      img1Cropped.data[idx+1] = img1.data[idx1+1];
      img1Cropped.data[idx+2] = img1.data[idx1+2];
      img1Cropped.data[idx+3] = img1.data[idx1+3];
      
      img2Cropped.data[idx] = img2.data[idx2];
      img2Cropped.data[idx+1] = img2.data[idx2+1];
      img2Cropped.data[idx+2] = img2.data[idx2+2];
      img2Cropped.data[idx+3] = img2.data[idx2+3];
    }
  }

  const diff = new PNG({ width, height });

  const numDiffPixels = pixelmatch(
    img1Cropped.data,
    img2Cropped.data,
    diff.data,
    width,
    height,
    { threshold: 0.1 }
  );

  const totalPixels = width * height;
  const diffRatio = numDiffPixels / totalPixels;
  const diffPercent = (diffRatio * 100).toFixed(2);

  fs.writeFileSync(comp.diff, PNG.sync.write(diff));
  console.log(`  Mismatch: ${numDiffPixels} / ${totalPixels} pixels (${diffPercent}%)`);
  console.log(`  Diff saved to: ${comp.diff}`);
  console.log();

  results.push({
    name: comp.name,
    reference: path.basename(comp.figma),
    actual: path.basename(comp.actual),
    region: `${width}x${height}`,
    diffPixels: numDiffPixels,
    diffPercent: `${diffPercent}%`,
    diffFile: comp.diff
  });
}

console.log('Visual Comparison Summary:');
console.table(results);

if (hasErrors) {
  process.exit(1);
}
