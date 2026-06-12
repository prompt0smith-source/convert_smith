import { spawn } from "node:child_process";
import path from "node:path";
import type { VideoInspection } from "../types/conversion.js";

type ProgressCallback = (progress: number, message: string) => void;

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  pix_fmt?: string;
  width?: number;
  height?: number;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: {
    format_name?: string;
    duration?: string;
  };
}

export class FfmpegEngine {
  constructor(
    private readonly ffmpegPath: string,
    private readonly ffprobePath: string
  ) {}

  async inspect(inputPath: string): Promise<VideoInspection> {
    const data = await this.probe(inputPath);
    const video = data.streams?.find((stream) => stream.codec_type === "video");
    const audio = data.streams?.find((stream) => stream.codec_type === "audio");
    const videoCodec = video?.codec_name?.toLowerCase();
    const audioCodec = audio?.codec_name?.toLowerCase();
    const pixelFormat = video?.pix_fmt?.toLowerCase();
    const isCompatible =
      videoCodec === "h264" && (!audio || audioCodec === "aac") && pixelFormat === "yuv420p";

    return {
      path: inputPath,
      extension: path.extname(inputPath).replace(".", "").toLowerCase(),
      container: data.format?.format_name,
      videoCodec,
      audioCodec,
      pixelFormat,
      durationSeconds: Number(data.format?.duration || 0) || undefined,
      width: video?.width,
      height: video?.height,
      hasVideo: Boolean(video),
      hasAudio: Boolean(audio),
      compatibilityMessage: isCompatible
        ? "일반적인 플레이어와 호환성이 높은 형식입니다."
        : "호환 변환 후: H.264 + AAC MP4",
      warning: isCompatible
        ? undefined
        : "이 파일은 일부 PC나 플레이어에서 재생되지 않을 수 있습니다. 호환성 복구 변환을 권장합니다."
    };
  }

  async convertMp4ToMp3(
    inputPath: string,
    outputPath: string,
    onProgress: ProgressCallback,
    signal?: AbortSignal
  ): Promise<void> {
    const inspection = await this.inspect(inputPath);
    if (!inspection.hasAudio) {
      throw new Error("동영상에 오디오 트랙이 없어 MP3를 만들 수 없습니다.");
    }

    await this.runFfmpeg(
      ["-y", "-i", inputPath, "-vn", "-codec:a", "libmp3lame", "-q:a", "2", outputPath],
      inspection.durationSeconds,
      onProgress,
      signal
    );
  }

  async convertToCompatibleMp4(
    inputPath: string,
    outputPath: string,
    onProgress: ProgressCallback,
    signal?: AbortSignal
  ): Promise<void> {
    const inspection = await this.inspect(inputPath);
    if (!inspection.hasVideo) {
      throw new Error("동영상 호환성 복구에는 비디오 트랙이 필요합니다.");
    }

    await this.runFfmpeg(
      [
        "-y",
        "-i",
        inputPath,
        "-map",
        "0:v:0?",
        "-map",
        "0:a:0?",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-movflags",
        "+faststart",
        outputPath
      ],
      inspection.durationSeconds,
      onProgress,
      signal
    );
  }

  async probe(filePath: string): Promise<FfprobeOutput> {
    const stdout = await this.runProcess(this.ffprobePath, [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath
    ]);

    return JSON.parse(stdout) as FfprobeOutput;
  }

  private runFfmpeg(
    args: string[],
    durationSeconds: number | undefined,
    onProgress: ProgressCallback,
    signal?: AbortSignal
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.ffmpegPath, args, {
        shell: false,
        windowsHide: true
      });

      let stderr = "";
      const abort = () => {
        child.kill("SIGTERM");
        reject(new Error("변환이 취소되었습니다."));
      };

      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });

      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        stderr += text;
        const timeSeconds = this.parseProgressSeconds(text);
        if (timeSeconds !== undefined && durationSeconds && durationSeconds > 0) {
          const progress = Math.max(5, Math.min(98, Math.round((timeSeconds / durationSeconds) * 100)));
          onProgress(progress, `FFmpeg 변환 중 ${progress}%`);
        }
      });

      child.on("error", (error) => {
        signal?.removeEventListener("abort", abort);
        reject(error);
      });
      child.on("close", (code) => {
        signal?.removeEventListener("abort", abort);
        if (code === 0) {
          onProgress(99, "출력 파일을 검증하는 중입니다.");
          resolve();
          return;
        }
        reject(new Error(`FFmpeg 변환 실패(code ${code}): ${stderr.slice(-3000)}`));
      });
    });
  }

  private runProcess(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        shell: false,
        windowsHide: true
      });
      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`ffprobe 실패(code ${code}): ${stderr.slice(-2000)}`));
        }
      });
    });
  }

  private parseProgressSeconds(text: string): number | undefined {
    const matches = [...text.matchAll(/time=(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/g)];
    const match = matches.at(-1);
    if (!match) return undefined;
    const [, hours, minutes, seconds] = match;
    return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
  }
}
