import path from "node:path";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import sharp from "sharp";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import ffmpegPath from "ffmpeg-static";
import { ConversionService } from "../dist-electron/main/services/ConversionService.js";
import { PdfToolService } from "../dist-electron/main/services/PdfToolService.js";

const root = path.resolve("tmp-smoke");
const options = {
  imageQuality: 90,
  pdfImageFormat: "jpg",
  pdfRenderScale: 2,
  pdfPageSize: "auto",
  pdfToDocxMode: "editable_text",
  videoCompatibilityMode: true,
  overwritePolicy: "increment",
  sortMode: "basic"
};

await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });

const pngInput = path.join(root, "sample.png");
await sharp({
  create: {
    width: 32,
    height: 32,
    channels: 4,
    background: { r: 31, g: 142, b: 101, alpha: 1 }
  }
})
  .png()
  .toFile(pngInput);

const service = new ConversionService();
const pngPreview = await service.getFilePreview(pngInput);
assertPreview("PNG preview", pngPreview);

const pngJob = await service.convert(
  {
    sourcePaths: [pngInput],
    outputDir: root,
    conversionType: "png_to_jpg",
    options
  },
  () => undefined
);
assertSuccess("PNG -> JPG", pngJob);

const webpJob = await service.convert(
  {
    sourcePaths: [pngInput],
    outputDir: root,
    conversionType: "image_to_webp",
    options
  },
  () => undefined
);
assertSuccess("PNG -> WEBP", webpJob);

const pdfInput = path.join(root, "sample.pdf");
const pdfDoc = await PDFDocument.create();
const page = pdfDoc.addPage([360, 220]);
const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
page.drawText("Convert Smith PDF Preview", {
  x: 36,
  y: 120,
  size: 18,
  font,
  color: rgb(0.1, 0.35, 0.25)
});
await writeFile(pdfInput, await pdfDoc.save());
const pdfPreview = await service.getFilePreview(pdfInput);
assertPreview("PDF preview", pdfPreview);

const pdfInputTwo = path.join(root, "sample-two.pdf");
const pdfDocTwo = await PDFDocument.create();
const secondPage = pdfDocTwo.addPage([240, 180]);
secondPage.drawText("Second PDF", { x: 30, y: 90, size: 16, font });
await writeFile(pdfInputTwo, await pdfDocTwo.save());

const pdfToolService = new PdfToolService();
const pdfInfo = await pdfToolService.getInfo(pdfInput);
if (pdfInfo.pageCount !== 1) {
  throw new Error(`PDF info returned unexpected page count: ${pdfInfo.pageCount}`);
}
const mergeJob = await pdfToolService.run(
  {
    sourcePaths: [pdfInput, pdfInputTwo],
    outputDir: root,
    toolType: "pdf_merge",
    options: { outputName: "merged_smoke" }
  },
  () => undefined
);
assertSuccess("PDF merge", mergeJob);

const splitJob = await pdfToolService.run(
  {
    sourcePaths: [mergeJob.outputPaths[0]],
    outputDir: root,
    toolType: "pdf_split_all",
    options: {}
  },
  () => undefined
);
assertSuccess("PDF split all", splitJob);
if (splitJob.outputPaths.length !== 2) {
  throw new Error(`PDF split expected 2 files, got ${splitJob.outputPaths.length}`);
}

const mp4Input = path.join(root, "sample.mp4");
await run(ffmpegPath, [
  "-y",
  "-f",
  "lavfi",
  "-i",
  "testsrc=size=64x64:rate=5",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=1000:duration=1",
  "-t",
  "1",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  mp4Input
]);

const mp3Job = await service.convert(
  {
    sourcePaths: [mp4Input],
    outputDir: root,
    conversionType: "mp4_to_mp3",
    options
  },
  () => undefined
);
assertSuccess("MP4 -> MP3", mp3Job);

const webmInput = path.join(root, "sample.webm");
await run(ffmpegPath, [
  "-y",
  "-f",
  "lavfi",
  "-i",
  "testsrc=size=64x64:rate=5",
  "-t",
  "1",
  "-c:v",
  "libvpx-vp9",
  webmInput
]);

const webmJob = await service.convert(
  {
    sourcePaths: [webmInput],
    outputDir: root,
    conversionType: "webm_to_mp4",
    options
  },
  () => undefined
);
assertSuccess("WEBM -> MP4", webmJob);

console.log("Smoke test passed");
console.log(`PNG -> JPG: ${pngJob.outputPaths[0]}`);
console.log(`PNG -> WEBP: ${webpJob.outputPaths[0]}`);
console.log(`PDF merge: ${mergeJob.outputPaths[0]}`);
console.log(`PDF split files: ${splitJob.outputPaths.length}`);
console.log(`MP4 -> MP3: ${mp3Job.outputPaths[0]}`);
console.log(`WEBM -> MP4: ${webmJob.outputPaths[0]}`);

async function assertSuccess(label, job) {
  if (job.status !== "success") {
    throw new Error(`${label} failed: ${job.error || job.message}`);
  }
  for (const outputPath of job.outputPaths) {
    const info = await stat(outputPath);
    if (info.size <= 0) {
      throw new Error(`${label} produced an empty output: ${outputPath}`);
    }
  }
}

function assertPreview(label, preview) {
  if (!preview.dataUrl || !preview.dataUrl.startsWith("data:image/png;base64,")) {
    throw new Error(`${label} did not produce an image data URL.`);
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed with code ${code}: ${stderr.slice(-2000)}`));
    });
  });
}
