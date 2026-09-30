import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "node:fs";
import path from "node:path";

const fonts = new Map<boolean, ReturnType<typeof fontkit.create>>();
export function arialMetrics(bold = false) {
  return { widthOfTextAtSize(value: string, size: number) {
    let font = fonts.get(bold);
    if (!font) { font = fontkit.create(readFileSync(path.join(process.cwd(), "src/server/document-assets", bold ? "arial-bold.ttf" : "arial.ttf"))); fonts.set(bold, font); }
    return font.layout(value).glyphs.reduce((sum, glyph) => sum + glyph.advanceWidth, 0) * size / font.unitsPerEm;
  } };
}
