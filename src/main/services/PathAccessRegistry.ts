import path from "node:path";
import { randomUUID } from "node:crypto";

const NOT_ALLOWED_MESSAGE =
  "앱에 추가된 파일만 열거나 미리볼 수 있습니다. 파일을 다시 추가해 주세요.";
const MAX_PREVIEW_TOKENS = 160;

export class PathAccessRegistry {
  private readonly allowedPaths = new Set<string>();
  private readonly previewTokens = new Map<string, string>();
  private readonly previewTokenOrder: string[] = [];

  registerPath(filePath: string): string {
    const resolved = this.resolveSafePath(filePath);
    this.allowedPaths.add(this.keyFor(resolved));
    return resolved;
  }

  registerPaths(filePaths: Iterable<string>): string[] {
    return Array.from(filePaths, (filePath) => this.registerPath(filePath));
  }

  assertAllowed(filePath: string): string {
    const resolved = this.resolveSafePath(filePath);
    if (!this.allowedPaths.has(this.keyFor(resolved))) {
      throw new Error(NOT_ALLOWED_MESSAGE);
    }
    return resolved;
  }

  isAllowed(filePath: string): boolean {
    try {
      const resolved = this.resolveSafePath(filePath);
      return this.allowedPaths.has(this.keyFor(resolved));
    } catch {
      return false;
    }
  }

  createPreviewUrl(filePath: string): string {
    const resolved = this.assertAllowed(filePath);
    const token = randomUUID();
    this.previewTokens.set(token, resolved);
    this.previewTokenOrder.push(token);
    while (this.previewTokenOrder.length > MAX_PREVIEW_TOKENS) {
      const staleToken = this.previewTokenOrder.shift();
      if (staleToken) this.previewTokens.delete(staleToken);
    }
    return `convert-smith-file://preview/${token}/${encodeURIComponent(path.basename(resolved))}`;
  }

  resolvePreviewToken(token: string): string {
    if (typeof token !== "string" || !token.trim()) {
      throw new Error("PDF 미리보기 접근 토큰이 올바르지 않습니다.");
    }
    const resolved = this.previewTokens.get(token);
    if (!resolved) {
      throw new Error("PDF 미리보기 접근 권한이 만료되었습니다. 파일을 다시 선택해 주세요.");
    }
    return resolved;
  }

  private resolveSafePath(filePath: string): string {
    if (typeof filePath !== "string" || !filePath.trim() || filePath.includes("\0")) {
      throw new Error("파일 경로가 올바르지 않습니다.");
    }
    return path.resolve(filePath.trim());
  }

  private keyFor(filePath: string): string {
    return process.platform === "win32" ? filePath.toLowerCase() : filePath;
  }
}
