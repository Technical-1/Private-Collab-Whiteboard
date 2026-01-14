import sharp from 'sharp';
import { readFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

// Ensure public directory exists
if (!existsSync(publicDir)) {
  mkdirSync(publicDir, { recursive: true });
}

// Generate favicon PNGs from SVG
async function generateFavicons() {
  const faviconSvg = readFileSync(join(publicDir, 'favicon.svg'));

  const sizes = [16, 32, 180, 192, 512];

  for (const size of sizes) {
    let filename;
    if (size === 180) {
      filename = 'apple-touch-icon.png';
    } else if (size === 192 || size === 512) {
      filename = `favicon-${size}x${size}.png`;
    } else {
      filename = `favicon-${size}x${size}.png`;
    }

    await sharp(faviconSvg)
      .resize(size, size)
      .png()
      .toFile(join(publicDir, filename));

    console.log(`Generated ${filename}`);
  }
}

// Generate OG image PNG from SVG
async function generateOgImage() {
  const ogSvg = readFileSync(join(publicDir, 'og-image.svg'));

  await sharp(ogSvg)
    .resize(1200, 630)
    .png()
    .toFile(join(publicDir, 'og-image.png'));

  console.log('Generated og-image.png');
}

async function main() {
  console.log('Generating icons...\n');

  try {
    await generateFavicons();
    await generateOgImage();
    console.log('\nAll icons generated successfully!');
  } catch (error) {
    console.error('Error generating icons:', error);
    process.exit(1);
  }
}

main();
