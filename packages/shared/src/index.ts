export function isObject(val: unknown): boolean {
  return typeof val === "object" && val !== null;
}
