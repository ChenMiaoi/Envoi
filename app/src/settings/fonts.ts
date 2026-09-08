export const fontId = (family: string) => `local:${family}`
export function normalizeFont(value: unknown, legacy: object): string {
  if (typeof value !== "string") return "system"
  if (Object.hasOwn(legacy, value)) return value
  return value.startsWith("local:") &&
    value.length > 6 &&
    value.length <= 256 &&
    ![...value].some((char) => char.charCodeAt(0) < 32)
    ? value
    : "system"
}
export function fontCss(value: string, legacy: Record<string, { css: string }>): string {
  if (Object.hasOwn(legacy, value)) return legacy[value].css
  return value.startsWith("local:")
    ? `${JSON.stringify(value.slice(6))}, ${legacy.system.css}`
    : legacy.system.css
}
export async function systemFonts() {
  const query = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> })
    .queryLocalFonts
  if (!query) throw Error("Local Font Access unavailable")
  const fonts = await query.call(window)
  const context = document.createElement("canvas").getContext("2d")
  return [...new Set(fonts.map((font) => font.family))]
    .filter(Boolean)
    .map((family) => {
      let mono = false
      if (context) {
        context.font = `16px ${JSON.stringify(family)}`
        mono = ["iiiiiiii", "WWWWWWWW", "00000000", "........"]
          .map((text) => context.measureText(text).width)
          .every((width, _, widths) => Math.abs(width - widths[0]) < 0.01)
      }
      return { family, mono }
    })
    .sort((a, b) => a.family.localeCompare(b.family))
}
