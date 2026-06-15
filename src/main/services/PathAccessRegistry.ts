import path from "node:path";

const NOT_ALLOWED_MESSAGE =
  "앱에 추가한 파일만 열거나 미리볼 수 있습니다. 파일을 다시 추가해주세요.";

export class PathAccessRegistry {
  private readonly allowedPaths = new Set<string>();

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
