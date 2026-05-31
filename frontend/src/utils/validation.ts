export function parseOptionalPort(value: string): number | undefined {
  const normalized = value.trim();
  if (!normalized) return undefined;

  if (!/^\d+$/.test(normalized)) {
    throw new Error("端口必须是 1-65535 之间的数字。");
  }

  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error("端口必须是 1-65535 之间的数字。");
  }

  return parsed;
}
