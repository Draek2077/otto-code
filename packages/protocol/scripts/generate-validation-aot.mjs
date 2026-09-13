import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(packageRoot, "codegen/ws-outbound.compile.ts");
const output = resolve(packageRoot, "src/generated/validation/ws-outbound.aot.ts");
const metadataOutput = resolve(packageRoot, "src/generated/validation/ws-outbound-metadata.aot.ts");
const dispatchOutput = resolve(packageRoot, "src/generated/validation/ws-outbound-dispatch.aot.ts");

const require = createRequire(import.meta.url);
const zodAotEntry = require.resolve("zod-aot");
const zodAotRoot = resolve(dirname(zodAotEntry), "..");
const emitterPath = resolve(zodAotRoot, "dist/cli/emitter.js");
const discriminatedUnionPath = resolve(
  zodAotRoot,
  "dist/core/codegen/schemas/discriminated-union.js",
);

async function ensureZodAotRuntimeImportExtensionPatch() {
  const emitter = await readFile(emitterPath, "utf8");
  if (emitter.includes('sourceRelPath.endsWith(".js")')) {
    return;
  }

  const before = 'let importPath = sourceRelPath.replace(/\\.[cm]?[jt]sx?$/, "");';
  const after =
    'let importPath = sourceRelPath.endsWith(".js")\n        ? sourceRelPath\n        : sourceRelPath.replace(/\\.[cm]?[jt]sx?$/, "");';
  if (!emitter.includes(before)) {
    throw new Error("zod-aot emitter shape changed; update the runtime import extension patch");
  }
  await writeFile(emitterPath, emitter.replace(before, after));
}

async function ensureZodAotDiscriminatedUnionOutputPatch() {
  let discriminatedUnionEmitter = await readFile(discriminatedUnionPath, "utf8");
  if (
    discriminatedUnionEmitter.includes(
      "const needsOutputPropagation = ir.options.some(hasMutation);",
    )
  ) {
    return;
  }

  const importBefore = 'import { escapeString } from "../context.js";';
  const importAfter = 'import { escapeString, hasMutation } from "../context.js";';
  const outputFlagBefore = "const discKey = escapeString(ir.discriminator);\n    let code = emit `";
  const outputFlagAfter =
    "const discKey = escapeString(ir.discriminator);\n    const needsOutputPropagation = ir.options.some(hasMutation);\n    let code = emit `";
  const propagationBefore =
    "        ${g.visit(option, { input: objVar, output: objVar })}\n        break;`;";
  const propagationAfter =
    '        ${g.visit(option, { input: objVar, output: objVar })}\n        ${needsOutputPropagation ? `${g.output}=${objVar};` : ""}\n        break;`;';

  if (
    !discriminatedUnionEmitter.includes(importBefore) ||
    !discriminatedUnionEmitter.includes(outputFlagBefore) ||
    !discriminatedUnionEmitter.includes(propagationBefore)
  ) {
    throw new Error("zod-aot discriminated-union emitter shape changed; update the output patch");
  }

  discriminatedUnionEmitter = discriminatedUnionEmitter
    .replace(importBefore, importAfter)
    .replace(outputFlagBefore, outputFlagAfter)
    .replace(propagationBefore, propagationAfter);
  await writeFile(discriminatedUnionPath, discriminatedUnionEmitter);
}

await Promise.all([
  ensureZodAotRuntimeImportExtensionPatch(),
  ensureZodAotDiscriminatedUnionOutputPatch(),
]);

const [{ discoverSchemas }, { compileSchemas }, { generateCompiledFileContent }] =
  await Promise.all([
    import(pathToFileURL(resolve(zodAotRoot, "dist/discovery.js")).href),
    import(pathToFileURL(resolve(zodAotRoot, "dist/core/pipeline.js")).href),
    import(pathToFileURL(resolve(zodAotRoot, "dist/cli/emitter.js")).href),
  ]);

const schemas = await discoverSchemas(source, { cacheBust: true });
if (schemas.length === 0) {
  throw new Error(`No zod-aot compile() exports found in ${relative(packageRoot, source)}`);
}

// One validator per outbound message type (codegen/ws-outbound.compile.ts explains why). The
// metadata module gives each generated validator a named source-schema reference for zod-aot
// fallbacks, and the dispatch module maps every message `type` literal to its validator.
const sessionExportPattern = /^SessionOutbound_(\d+)$/;
const metadataExports = [];
const dispatchEntries = [];
const sessionExportNames = [];
const typeOwners = new Map();
let hasPongValidator = false;
for (const { exportName, schema } of schemas) {
  if (exportName === "WSPongMessage") {
    hasPongValidator = true;
    metadataExports.push("export const WSPongMessage = { schema: WSPongMessageSchema };");
    continue;
  }
  const match = sessionExportPattern.exec(exportName);
  if (!match) {
    throw new Error(`Unexpected zod-aot export ${exportName} in ${relative(packageRoot, source)}`);
  }
  sessionExportNames.push(exportName);
  metadataExports.push(
    `export const ${exportName} = { schema: SessionOutboundMessageSchema.options[${match[1]}] };`,
  );
  const typeValues = schema.shape?.type?._zod?.def?.values;
  if (!Array.isArray(typeValues) || typeValues.length === 0) {
    throw new Error(`${exportName} has no literal type discriminator`);
  }
  for (const typeValue of typeValues) {
    if (typeOwners.has(typeValue)) {
      throw new Error(
        `Outbound message type ${typeValue} is declared by both ${typeOwners.get(typeValue)} and ${exportName}`,
      );
    }
    typeOwners.set(typeValue, exportName);
    dispatchEntries.push(`  [${JSON.stringify(typeValue)}, ${exportName}],`);
  }
}
if (!hasPongValidator) {
  throw new Error(`WSPongMessage is missing from ${relative(packageRoot, source)}`);
}

const generatedHeader = "// AUTO-GENERATED by scripts/generate-validation-aot.mjs - DO NOT EDIT";
const compiled = compileSchemas(schemas, { mode: "inline" });
const content = generateCompiledFileContent(compiled, `./${basename(metadataOutput, ".ts")}.js`, {
  zodCompat: false,
}).replace(
  "// AUTO-GENERATED by zod-aot — DO NOT EDIT",
  "// @ts-nocheck\n// AUTO-GENERATED by zod-aot — DO NOT EDIT",
);
const metadataContent = [
  "// @ts-nocheck",
  generatedHeader,
  'import { SessionOutboundMessageSchema, WSPongMessageSchema } from "../../messages.js";',
  "",
  ...metadataExports,
  "",
].join("\n");
const dispatchContent = [
  "// @ts-nocheck",
  generatedHeader,
  `import { WSPongMessage, ${sessionExportNames.join(", ")} } from "./${basename(output, ".ts")}.js";`,
  "",
  "export const pongValidator = WSPongMessage;",
  "export const sessionOutboundValidators = new Map([",
  ...dispatchEntries,
  "]);",
  "",
].join("\n");

await mkdir(dirname(output), { recursive: true });
await Promise.all([
  writeFile(output, content),
  writeFile(metadataOutput, metadataContent),
  writeFile(dispatchOutput, dispatchContent),
]);

console.info(
  `generated ${relative(packageRoot, dirname(output))} from ${relative(packageRoot, source)} (WSPongMessage and ${sessionExportNames.length} session message validators)`,
);
