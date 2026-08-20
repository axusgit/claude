// Regenerates the stored Axus BAA template PDF at aesign/templates/axus-baa.pdf.
// Run from the backend package:  npm run gen:baa
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateBaaPdf } from "../baapdf.js";
const here = dirname(fileURLToPath(import.meta.url)); // backend/src/scripts
const assetsDir = join(here, "..", "..", "assets"); // backend/assets
const outDir = join(here, "..", "..", "..", "templates"); // aesign/templates
const outPath = join(outDir, "axus-baa.pdf");
const bytes = await generateBaaPdf(assetsDir);
await mkdir(outDir, { recursive: true });
await writeFile(outPath, bytes);
console.log(`Wrote ${outPath} (${bytes.length} bytes)`);
//# sourceMappingURL=genBaaTemplate.js.map