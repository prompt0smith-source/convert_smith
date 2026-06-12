import { open } from "node:fs/promises";

export class FileSignatureService {
  async readBytes(filePath: string, length: number): Promise<Buffer> {
    const handle = await open(filePath, "r");
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  async isPdf(filePath: string): Promise<boolean> {
    const bytes = await this.readBytes(filePath, 5);
    return bytes.toString("utf8") === "%PDF-";
  }

  async isJpeg(filePath: string): Promise<boolean> {
    const bytes = await this.readBytes(filePath, 3);
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }

  async isPng(filePath: string): Promise<boolean> {
    const bytes = await this.readBytes(filePath, 8);
    return bytes.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }

  async isWebp(filePath: string): Promise<boolean> {
    const bytes = await this.readBytes(filePath, 12);
    return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  }

  async isZip(filePath: string): Promise<boolean> {
    const bytes = await this.readBytes(filePath, 4);
    return bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
  }
}
