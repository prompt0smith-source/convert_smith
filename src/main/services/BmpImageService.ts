import sharp from "sharp";

interface BmpRawImage {
  data: Buffer;
  width: number;
  height: number;
}

export async function decodeBmpToPngBuffer(input: Buffer): Promise<Buffer> {
  const raw = decodeBmpToRgba(input);
  return sharp(raw.data, {
    raw: {
      width: raw.width,
      height: raw.height,
      channels: 4
    }
  })
    .png()
    .toBuffer();
}

function decodeBmpToRgba(input: Buffer): BmpRawImage {
  if (input.length < 54 || input.toString("ascii", 0, 2) !== "BM") {
    throw new Error("지원하지 않는 BMP 파일입니다.");
  }

  const pixelOffset = input.readUInt32LE(10);
  const dibHeaderSize = input.readUInt32LE(14);
  if (dibHeaderSize < 40) {
    throw new Error("지원하지 않는 BMP DIB 헤더입니다.");
  }

  const width = input.readInt32LE(18);
  const signedHeight = input.readInt32LE(22);
  const height = Math.abs(signedHeight);
  const topDown = signedHeight < 0;
  const planes = input.readUInt16LE(26);
  const bitsPerPixel = input.readUInt16LE(28);
  const compression = input.readUInt32LE(30);

  if (width <= 0 || height <= 0 || planes !== 1) {
    throw new Error("BMP 이미지 크기 정보가 올바르지 않습니다.");
  }
  if (compression !== 0) {
    throw new Error("압축 BMP는 아직 지원하지 않습니다.");
  }
  if (bitsPerPixel !== 24 && bitsPerPixel !== 32) {
    throw new Error("24bit 또는 32bit BMP만 지원합니다.");
  }

  const bytesPerPixel = bitsPerPixel / 8;
  const rowSize = Math.floor((bitsPerPixel * width + 31) / 32) * 4;
  const requiredSize = pixelOffset + rowSize * height;
  if (input.length < requiredSize) {
    throw new Error("BMP 픽셀 데이터가 부족합니다.");
  }

  const output = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = topDown ? y : height - 1 - y;
    const sourceRow = pixelOffset + sourceY * rowSize;
    for (let x = 0; x < width; x += 1) {
      const source = sourceRow + x * bytesPerPixel;
      const target = (y * width + x) * 4;
      output[target] = input[source + 2];
      output[target + 1] = input[source + 1];
      output[target + 2] = input[source];
      output[target + 3] = bitsPerPixel === 32 ? input[source + 3] : 255;
    }
  }

  return { data: output, width, height };
}
