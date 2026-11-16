/**
 * ABAC 条件求值：条件以 jsonb 存在 admin_role_permissions.conditions 上。
 * 支持 { all: [] } / { any: [] } / { not: {} } 组合，以及属性叶子条件。
 */
export type AbacContext = {
  subject: Record<string, unknown>;
  resource: Record<string, unknown>;
  env: Record<string, unknown>;
};

const LEAF_OPS = ['eq', 'neq', 'in', 'notIn', 'contains', 'gt', 'gte', 'lt', 'lte', 'exists'] as const;
type LeafOp = (typeof LEAF_OPS)[number];

function readPath(source: unknown, path: string): unknown {
  if (!path) return source;
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, source);
}

function compare(actual: unknown, op: LeafOp, expected: unknown): boolean {
  switch (op) {
    case 'eq':
      return actual === expected;
    case 'neq':
      return actual !== expected;
    case 'in':
      return Array.isArray(expected) && expected.includes(actual as never);
    case 'notIn':
      return Array.isArray(expected) && !expected.includes(actual as never);
    case 'contains':
      if (Array.isArray(actual)) return actual.includes(expected as never);
      if (typeof actual === 'string' && typeof expected === 'string') return actual.includes(expected);
      return false;
    case 'gt':
      return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
    case 'gte':
      return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
    case 'lt':
      return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
    case 'lte':
      return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
    case 'exists':
      return expected === false ? actual === undefined : actual !== undefined;
    default:
      return false;
  }
}

export function evaluateCondition(condition: unknown, ctx: AbacContext): boolean {
  if (condition === null || condition === undefined) return true;
  if (typeof condition !== 'object' || Array.isArray(condition)) return false;

  const node = condition as Record<string, unknown>;
  if (Array.isArray(node.all)) {
    return node.all.every((item) => evaluateCondition(item, ctx));
  }
  if (Array.isArray(node.any)) {
    return node.any.some((item) => evaluateCondition(item, ctx));
  }
  if ('not' in node) {
    return !evaluateCondition(node.not, ctx);
  }

  const { attr, op, value } = node;
  if (typeof attr !== 'string' || typeof op !== 'string' || !LEAF_OPS.includes(op as LeafOp)) {
    return false;
  }

  const [scope, ...rest] = attr.split('.');
  const root =
    scope === 'subject' ? ctx.subject : scope === 'resource' ? ctx.resource : scope === 'env' ? ctx.env : undefined;
  const actual = readPath(root, rest.join('.'));
  return compare(actual, op as LeafOp, value);
}

/** 写入前做结构校验，避免存进无法求值的条件 */
export function validateCondition(condition: unknown, depth = 0): string | null {
  if (condition === null || condition === undefined) return null;
  if (typeof condition !== 'object' || Array.isArray(condition)) return '条件必须是对象';
  if (depth > 5) return '条件嵌套过深';

  const node = condition as Record<string, unknown>;
  if (Array.isArray(node.all)) {
    for (const item of node.all) {
      const error = validateCondition(item, depth + 1);
      if (error) return error;
    }
    return null;
  }
  if (Array.isArray(node.any)) {
    for (const item of node.any) {
      const error = validateCondition(item, depth + 1);
      if (error) return error;
    }
    return null;
  }
  if ('not' in node) return validateCondition(node.not, depth + 1);

  if (typeof node.attr !== 'string' || !/^(subject|resource|env)\./.test(node.attr)) {
    return 'attr 需以 subject./resource./env. 开头';
  }
  if (typeof node.op !== 'string' || !LEAF_OPS.includes(node.op as LeafOp)) {
    return `op 仅支持 ${LEAF_OPS.join(' / ')}`;
  }
  if (node.op === 'in' || node.op === 'notIn') {
    if (!Array.isArray(node.value)) return 'in / notIn 的 value 必须是数组';
  }
  return null;
}
