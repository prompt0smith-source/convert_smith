declare module "ffmpeg-static" {
  const path: string | null;
  export default path;
}

declare module "ffprobe-static" {
  const ffprobeStatic: { path: string };
  export default ffprobeStatic;
}

declare module "heic-convert" {
  interface HeicConvertOptions {
    buffer: Buffer;
    format: "JPEG" | "PNG";
    quality?: number;
  }

  function convert(options: HeicConvertOptions): Promise<ArrayBuffer>;
  export default convert;
}
