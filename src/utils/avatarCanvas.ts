import { fnv1a32 } from "./hash";
import { authorInitials } from "./text";
import type { ThemeName } from "../appSettingsStore";

const generatedCache = new Map<string, string>();

export function generateAvatarDataUrl(author: string, theme: ThemeName, size = 28): string {
  const key = `${author}::${theme}::${size}`;
  const cached = generatedCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const r = size / 2;

  ctx.beginPath();
  ctx.arc(r, r, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  const hue1 = fnv1a32(author) % 360;
  const hue2 = (fnv1a32(author + "::2") + 28) % 360;
  const sat = 72;
  const light1 = theme === "dark" ? 58 : 46;
  const light2 = theme === "dark" ? 48 : 38;

  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, `hsl(${hue1}, ${sat}%, ${light1}%)`);
  grad.addColorStop(1, `hsl(${hue2}, ${sat}%, ${light2}%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const glassGrad = ctx.createRadialGradient(
    size * 0.35, size * 0.28, 0,
    size * 0.35, size * 0.28, size * 0.5,
  );
  glassGrad.addColorStop(0, "rgba(255, 255, 255, 0.55)");
  glassGrad.addColorStop(0.5, "rgba(255, 255, 255, 0.08)");
  glassGrad.addColorStop(1, "transparent");
  ctx.fillStyle = glassGrad;
  ctx.fillRect(0, 0, size, size);

  const bottomGrad = ctx.createRadialGradient(
    size * 0.6, size * 0.85, 0,
    size * 0.6, size * 0.85, size * 0.35,
  );
  bottomGrad.addColorStop(0, "rgba(255, 255, 255, 0.12)");
  bottomGrad.addColorStop(1, "transparent");
  ctx.fillStyle = bottomGrad;
  ctx.fillRect(0, 0, size, size);

  const initials = authorInitials(author);
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.font = `900 ${size * 0.42}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0, 0, 0, 0.25)";
  ctx.shadowBlur = 2;
  ctx.shadowOffsetY = 1;
  ctx.fillText(initials, r, r + 1);

  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  ctx.beginPath();
  ctx.arc(r, r, r - 0.5, 0, Math.PI * 2);
  ctx.closePath();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
  ctx.lineWidth = 1;
  ctx.stroke();

  const url = canvas.toDataURL("image/png");
  generatedCache.set(key, url);
  return url;
}

const gravatarCircleCache = new Map<string, string>();
const gravatarLoadingSet = new Set<string>();
const gravatarFailedSet = new Set<string>();

export function getGravatarCircleUrl(email: string, size = 28): string | null {
  const key = `${email}::${size}`;
  return gravatarCircleCache.get(key) ?? null;
}

export function loadGravatarCircle(
  email: string,
  md5: string,
  size: number,
  onReady: () => void,
): void {
  const key = `${email}::${size}`;
  if (gravatarCircleCache.has(key) || gravatarLoadingSet.has(key) || gravatarFailedSet.has(key)) return;
  gravatarLoadingSet.add(key);

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    gravatarLoadingSet.delete(key);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const r = size / 2;
    ctx.beginPath();
    ctx.arc(r, r, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, 0, 0, size, size);

    ctx.beginPath();
    ctx.arc(r, r, r - 0.5, 0, Math.PI * 2);
    ctx.closePath();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
    ctx.lineWidth = 1;
    ctx.stroke();

    gravatarCircleCache.set(key, canvas.toDataURL("image/png"));
    onReady();
  };
  img.onerror = () => {
    gravatarLoadingSet.delete(key);
    gravatarFailedSet.add(key);
  };
  img.src = `https://www.gravatar.com/avatar/${md5}?d=404&s=${size * 2}`;
}
