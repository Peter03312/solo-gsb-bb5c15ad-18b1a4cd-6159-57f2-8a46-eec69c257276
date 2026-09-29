// 导入校验：页面 JSON 导入与服务端 POST /api/validate 共用同一套规则。
// 规则概览：
// - 导出包形态 { document, ... } 与持久化形态 { doc, ... } 均接受；
// - root 必须是数组（空数组合法：空文档可导入）；
// - 树深度严格为 条 → 款 → 项：顶层只能是条，条下只能是款，款下只能是项，项不得再有子节点；
// - 每个节点必须带非空字符串 id、与层级相符的 kind、字符串 text、数组 children；
// - 全树节点 id 必须唯一（重复 id 会导致分析索引互相覆盖，引用定位与审签可能串到错误节点）；
// - title / suffix / ordinal / document.id 等非结构字段仅在出现时做类型检查，
//   缺失不判错（ordinal 导入时会按结构位置重新编号）。
// 校验只读检查入参，不修改任何对象；任一不合格返回首个原因，调用方须原样保留
// 当前正文、审阅留痕与撤销历史，不得提交导入事务。

import type { ClauseDocument, NodeKind } from './model';

const KIND_LABEL: Record<NodeKind, string> = {
  article: '条',
  paragraph: '款',
  item: '项',
};

/** 校验通过：返回提取到的文档对象（与入参同一引用，未做克隆或写入） */
export interface ImportValidationOk {
  ok: true;
  document: ClauseDocument;
}

/** 校验失败：reason 为可直接展示给用户的中文原因（含结构位置） */
export interface ImportValidationError {
  ok: false;
  reason: string;
}

export type ImportValidationResult = ImportValidationOk | ImportValidationError;

const fail = (reason: string): ImportValidationError => ({ ok: false, reason });

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const EXPECTED_KIND: NodeKind[] = ['article', 'paragraph', 'item'];

/**
 * 校验单个节点。
 * @param depth 0=条（document.root 顶层），1=款，2=项
 */
function validateNode(
  raw: unknown,
  depth: number,
  path: string,
  seenIds: Set<string>,
): ImportValidationError | null {
  const expectedKind = EXPECTED_KIND[depth];
  const label = KIND_LABEL[expectedKind];
  if (!isRecord(raw)) return fail(`${path}：节点必须是对象（应为「${label}」）`);

  const id = raw.id;
  if (typeof id !== 'string' || id.trim() === '') {
    return fail(`${path}：缺少必需字段 id（非空字符串）`);
  }
  if (seenIds.has(id)) {
    return fail(`${path}：节点 id「${id}」在树中重复，全树节点 id 必须唯一`);
  }
  seenIds.add(id);

  if (raw.kind !== expectedKind) {
    return fail(
      `${path}（id=${id}）：节点类型必须为「${expectedKind}」（${label}），实际为 ${JSON.stringify(raw.kind)}`,
    );
  }

  if (typeof raw.text !== 'string') {
    return fail(`${path}（id=${id}）：缺少必需字段 text（字符串，可为空串）`);
  }

  if (!Array.isArray(raw.children)) {
    return fail(`${path}（id=${id}）：缺少必需字段 children（数组，${label === '项' ? '项的 children 必须为空数组' : '可为空数组'}）`);
  }

  if (raw.title !== undefined && typeof raw.title !== 'string') {
    return fail(`${path}（id=${id}）：title 必须是字符串`);
  }
  if (raw.suffix !== undefined && typeof raw.suffix !== 'string') {
    return fail(`${path}（id=${id}）：suffix 必须是字符串`);
  }
  if (raw.ordinal !== undefined && (typeof raw.ordinal !== 'number' || !Number.isFinite(raw.ordinal))) {
    return fail(`${path}（id=${id}）：ordinal 必须是有限数字（导入时会按结构位置重新编号）`);
  }

  if (depth === 2) {
    if (raw.children.length > 0) {
      return fail(`${path}（id=${id}）：项之下不允许再有子节点，children 必须为空数组`);
    }
    return null;
  }

  const childLabel = KIND_LABEL[EXPECTED_KIND[depth + 1]];
  for (let i = 0; i < raw.children.length; i++) {
    const childPath = `${path} 的第 ${i + 1} 个${childLabel}`;
    const childError = validateNode(raw.children[i], depth + 1, childPath, seenIds);
    if (childError) return childError;
  }
  return null;
}

/** 校验 document / doc 文档对象本身（结构层级、必需字段、全树 ID 唯一性） */
export function validateClauseDocument(rawDoc: unknown): ImportValidationResult {
  if (!isRecord(rawDoc)) return fail('document 必须是对象');
  if (rawDoc.id !== undefined && typeof rawDoc.id !== 'string') {
    return fail('document.id 必须是字符串');
  }
  if (rawDoc.title !== undefined && typeof rawDoc.title !== 'string') {
    return fail('document.title 必须是字符串');
  }
  if (!Array.isArray(rawDoc.root)) {
    return fail('缺少 document.root（必须为条节点数组；空文档请传空数组 []）');
  }
  const seenIds = new Set<string>();
  for (let i = 0; i < rawDoc.root.length; i++) {
    const error = validateNode(rawDoc.root[i], 0, `document.root 第 ${i + 1} 个条`, seenIds);
    if (error) return error;
  }
  return { ok: true, document: rawDoc as unknown as ClauseDocument };
}

/**
 * 校验完整导入包：接受导出包形态（{ document }）与持久化形态（{ doc }）。
 * 仅校验文档结构；confirmed / snapshots / annotations 等附属记录仍由
 * 各 sanitize* 函数按旧数据缺省规则规整，不在这里拦截。
 */
export function validateImportBundle(input: unknown): ImportValidationResult {
  if (!isRecord(input)) return fail('导入文件必须是 JSON 对象');
  const rawDoc = 'document' in input ? input.document : (input as { doc?: unknown }).doc;
  if (rawDoc === undefined || rawDoc === null) {
    return fail('导入文件缺少 document（导出包应包含 document 字段）');
  }
  return validateClauseDocument(rawDoc);
}
