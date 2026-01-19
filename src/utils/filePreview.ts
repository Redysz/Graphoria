export function fileExtLower(path: string) {
  const p = path.trim().toLowerCase();
  const idx = p.lastIndexOf(".");
  if (idx < 0) return "";
  return p.slice(idx + 1);
}

export function isImageExt(ext: string) {
  return ext === "jpg" || ext === "jpeg" || ext === "png" || ext === "webp" || ext === "gif" || ext === "bmp";
}

export function imageMimeFromExt(ext: string) {
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "bmp") return "image/bmp";
  return "application/octet-stream";
}

export function isDocTextPreviewExt(ext: string) {
  return ext === "docx" || ext === "pdf" || ext === "xlsx" || ext === "xlsm" || ext === "xltx" || ext === "xltm";
}
