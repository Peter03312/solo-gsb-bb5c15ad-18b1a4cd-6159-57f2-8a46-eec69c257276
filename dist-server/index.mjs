// server/index.ts
import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// shared/importValidate.ts
var KIND_LABEL = {
  article: "\u6761",
  paragraph: "\u6B3E",
  item: "\u9879"
};
var fail = (reason) => ({ ok: false, reason });
function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
var EXPECTED_KIND = ["article", "paragraph", "item"];
function validateNode(raw, depth, path2, seenIds) {
  const expectedKind = EXPECTED_KIND[depth];
  const label = KIND_LABEL[expectedKind];
  if (!isRecord(raw)) return fail(`${path2}\uFF1A\u8282\u70B9\u5FC5\u987B\u662F\u5BF9\u8C61\uFF08\u5E94\u4E3A\u300C${label}\u300D\uFF09`);
  const id = raw.id;
  if (typeof id !== "string" || id.trim() === "") {
    return fail(`${path2}\uFF1A\u7F3A\u5C11\u5FC5\u9700\u5B57\u6BB5 id\uFF08\u975E\u7A7A\u5B57\u7B26\u4E32\uFF09`);
  }
  if (seenIds.has(id)) {
    return fail(`${path2}\uFF1A\u8282\u70B9 id\u300C${id}\u300D\u5728\u6811\u4E2D\u91CD\u590D\uFF0C\u5168\u6811\u8282\u70B9 id \u5FC5\u987B\u552F\u4E00`);
  }
  seenIds.add(id);
  if (raw.kind !== expectedKind) {
    return fail(
      `${path2}\uFF08id=${id}\uFF09\uFF1A\u8282\u70B9\u7C7B\u578B\u5FC5\u987B\u4E3A\u300C${expectedKind}\u300D\uFF08${label}\uFF09\uFF0C\u5B9E\u9645\u4E3A ${JSON.stringify(raw.kind)}`
    );
  }
  if (typeof raw.text !== "string") {
    return fail(`${path2}\uFF08id=${id}\uFF09\uFF1A\u7F3A\u5C11\u5FC5\u9700\u5B57\u6BB5 text\uFF08\u5B57\u7B26\u4E32\uFF0C\u53EF\u4E3A\u7A7A\u4E32\uFF09`);
  }
  if (!Array.isArray(raw.children)) {
    return fail(`${path2}\uFF08id=${id}\uFF09\uFF1A\u7F3A\u5C11\u5FC5\u9700\u5B57\u6BB5 children\uFF08\u6570\u7EC4\uFF0C${label === "\u9879" ? "\u9879\u7684 children \u5FC5\u987B\u4E3A\u7A7A\u6570\u7EC4" : "\u53EF\u4E3A\u7A7A\u6570\u7EC4"}\uFF09`);
  }
  if (raw.title !== void 0 && typeof raw.title !== "string") {
    return fail(`${path2}\uFF08id=${id}\uFF09\uFF1Atitle \u5FC5\u987B\u662F\u5B57\u7B26\u4E32`);
  }
  if (raw.suffix !== void 0 && typeof raw.suffix !== "string") {
    return fail(`${path2}\uFF08id=${id}\uFF09\uFF1Asuffix \u5FC5\u987B\u662F\u5B57\u7B26\u4E32`);
  }
  if (raw.ordinal !== void 0 && (typeof raw.ordinal !== "number" || !Number.isFinite(raw.ordinal))) {
    return fail(`${path2}\uFF08id=${id}\uFF09\uFF1Aordinal \u5FC5\u987B\u662F\u6709\u9650\u6570\u5B57\uFF08\u5BFC\u5165\u65F6\u4F1A\u6309\u7ED3\u6784\u4F4D\u7F6E\u91CD\u65B0\u7F16\u53F7\uFF09`);
  }
  if (depth === 2) {
    if (raw.children.length > 0) {
      return fail(`${path2}\uFF08id=${id}\uFF09\uFF1A\u9879\u4E4B\u4E0B\u4E0D\u5141\u8BB8\u518D\u6709\u5B50\u8282\u70B9\uFF0Cchildren \u5FC5\u987B\u4E3A\u7A7A\u6570\u7EC4`);
    }
    return null;
  }
  const childLabel = KIND_LABEL[EXPECTED_KIND[depth + 1]];
  for (let i = 0; i < raw.children.length; i++) {
    const childPath = `${path2} \u7684\u7B2C ${i + 1} \u4E2A${childLabel}`;
    const childError = validateNode(raw.children[i], depth + 1, childPath, seenIds);
    if (childError) return childError;
  }
  return null;
}
function validateClauseDocument(rawDoc) {
  if (!isRecord(rawDoc)) return fail("document \u5FC5\u987B\u662F\u5BF9\u8C61");
  if (rawDoc.id !== void 0 && typeof rawDoc.id !== "string") {
    return fail("document.id \u5FC5\u987B\u662F\u5B57\u7B26\u4E32");
  }
  if (rawDoc.title !== void 0 && typeof rawDoc.title !== "string") {
    return fail("document.title \u5FC5\u987B\u662F\u5B57\u7B26\u4E32");
  }
  if (!Array.isArray(rawDoc.root)) {
    return fail("\u7F3A\u5C11 document.root\uFF08\u5FC5\u987B\u4E3A\u6761\u8282\u70B9\u6570\u7EC4\uFF1B\u7A7A\u6587\u6863\u8BF7\u4F20\u7A7A\u6570\u7EC4 []\uFF09");
  }
  const seenIds = /* @__PURE__ */ new Set();
  for (let i = 0; i < rawDoc.root.length; i++) {
    const error = validateNode(rawDoc.root[i], 0, `document.root \u7B2C ${i + 1} \u4E2A\u6761`, seenIds);
    if (error) return error;
  }
  return { ok: true, document: rawDoc };
}
function validateImportBundle(input) {
  if (!isRecord(input)) return fail("\u5BFC\u5165\u6587\u4EF6\u5FC5\u987B\u662F JSON \u5BF9\u8C61");
  const rawDoc = "document" in input ? input.document : input.doc;
  if (rawDoc === void 0 || rawDoc === null) {
    return fail("\u5BFC\u5165\u6587\u4EF6\u7F3A\u5C11 document\uFF08\u5BFC\u51FA\u5305\u5E94\u5305\u542B document \u5B57\u6BB5\uFF09");
  }
  return validateClauseDocument(rawDoc);
}

// server/index.ts
var here = path.dirname(fileURLToPath(import.meta.url));
var PORT = Number(process.env.PORT ?? 3e3);
var DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(process.env.HOME ?? process.cwd(), ".clause-reference-validator");
var DATA_FILE = path.join(DATA_DIR, "state.json");
var app = express();
app.use(express.json({ limit: "10mb" }));
function isPersistedState(v) {
  if (!v || typeof v !== "object") return false;
  const doc = v.doc;
  return Boolean(doc && Array.isArray(doc.root) && typeof doc.title === "string");
}
async function readState() {
  try {
    const raw = await fsp.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return isPersistedState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
async function atomicWriteState(state) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const payload = JSON.stringify(state);
  const tmp = path.join(DATA_DIR, `.state.${process.pid}.${crypto.randomUUID()}.tmp`);
  let fh = null;
  try {
    fh = await fsp.open(tmp, "wx");
    await fh.writeFile(payload, "utf8");
    await fh.sync();
    await fh.close();
    fh = null;
    await fsp.rename(tmp, DATA_FILE);
  } catch (err) {
    if (fh) await fh.close().catch(() => void 0);
    await fsp.rm(tmp, { force: true }).catch(() => void 0);
    throw err;
  }
}
var writeChain = Promise.resolve();
function enqueueWrite(state) {
  const next = writeChain.then(() => atomicWriteState(state));
  writeChain = next.then(
    () => void 0,
    () => void 0
  );
  return next;
}
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "clause-reference-validator" });
});
app.get("/api/state", async (_req, res) => {
  const state = await readState();
  res.json({ state });
});
app.put("/api/state", async (req, res) => {
  const body = req.body;
  if (!isPersistedState(body)) {
    res.status(400).json({ error: "\u6570\u636E\u683C\u5F0F\u4E0D\u5408\u6CD5\uFF1A\u9700\u8981 { doc: { title, root }, confirmed }" });
    return;
  }
  try {
    await enqueueWrite(body);
    res.json({ ok: true, savedAt: Date.now() });
  } catch (err) {
    res.status(500).json({ error: `\u4FDD\u5B58\u5931\u8D25\uFF1A${err.message}` });
  }
});
app.post("/api/validate", (req, res) => {
  const result = validateImportBundle(req.body);
  if (!result.ok) {
    res.status(400).json({ error: result.reason });
    return;
  }
  const doc = result.document;
  res.json({ ok: true, title: doc.title, rootCount: doc.root.length });
});
var distDir = path.resolve(here, "../dist");
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.use((req, res, next) => {
    if (req.method === "GET" && !req.path.startsWith("/api")) {
      res.sendFile(path.join(distDir, "index.html"));
    } else {
      next();
    }
  });
}
async function cleanupStaleTmpFiles() {
  try {
    const entries = await fs.promises.readdir(DATA_DIR);
    await Promise.all(
      entries.filter(
        (name) => name.startsWith(".state.") && name.endsWith(".tmp") || name === "state.json.tmp"
      ).map(
        (name) => fs.promises.rm(path.join(DATA_DIR, name), { force: true }).catch(() => void 0)
      )
    );
  } catch {
  }
}
void (async () => {
  await cleanupStaleTmpFiles();
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`\u6761\u6B3E\u5F15\u7528\u6821\u9A8C\u53F0\u5DF2\u542F\u52A8\uFF1A http://localhost:${PORT}`);
    console.log(`\u672C\u5730\u6570\u636E\u6587\u4EF6\uFF1A${DATA_FILE}`);
  });
})();
