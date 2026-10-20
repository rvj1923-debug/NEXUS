import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

const MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
};

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  try {
    const resolvedParams = await context.params;
    const segments = Array.isArray(resolvedParams?.path) ? resolvedParams.path : [];
    if (segments.length === 0 || segments.some((s) => !s || s === "." || s === ".." || s.includes("\\") || s.includes("/"))) {
      return new NextResponse("Not Found", { status: 404 });
    }

    const baseUploadDir = path.resolve(
      process.cwd(),
      process.env.UPLOAD_DIR || process.env.UPLOADS_DIR || path.join("public", "uploads")
    );
    const targetPath = path.resolve(baseUploadDir, ...segments);

    // Ensure path stays strictly inside baseUploadDir
    const rel = path.relative(baseUploadDir, targetPath);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
      return new NextResponse("Not Found", { status: 404 });
    }

    const ext = path.extname(targetPath).toLowerCase();
    const contentType = MIME_MAP[ext] || "application/octet-stream";
    const buffer = fs.readFileSync(targetPath);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
