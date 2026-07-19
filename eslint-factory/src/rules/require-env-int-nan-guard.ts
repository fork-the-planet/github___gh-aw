// Redesigned rule: no-env-truthy-int-guard
// Flag: process.env.X ? parseInt(process.env.X, ...) : <fallback>
// because a truthy check does not guard against non-numeric strings producing NaN.

import { AST_NODE_TYPES, ESLintUtils, TSESTree } from "@typescript-eslint/utils";

const createRule = ESLintUtils.RuleCreator(name => `https://github.com/github/gh-aw/tree/main/eslint-factory#${name}`);

/**
 * Returns true if node is a process.env member access:
 *   process.env.FOO   → matches
 *   process.env["FOO"] → matches
 *   process.env.FOO?.trim() → matches (via ChainExpression / CallExpression)
 */
function isProcessEnvAccess(node: TSESTree.Node): boolean {
  if (node.type === AST_NODE_TYPES.MemberExpression) {
    const obj = node.object;
    if (
      obj.type === AST_NODE_TYPES.MemberExpression &&
      !obj.computed &&
      obj.object.type === AST_NODE_TYPES.Identifier &&
      obj.object.name === "process" &&
      obj.property.type === AST_NODE_TYPES.Identifier &&
      obj.property.name === "env"
    ) {
      return true;
    }
  }
  if (node.type === AST_NODE_TYPES.ChainExpression) {
    return isProcessEnvAccess(node.expression);
  }
  return false;
}

/**
 * Extract the env var name from a process.env.FOO access.
 */
function getEnvVarName(node: TSESTree.Node): string {
  if (node.type === AST_NODE_TYPES.MemberExpression) {
    if (node.property.type === AST_NODE_TYPES.Identifier) {
      return node.property.name;
    }
    if (node.property.type === AST_NODE_TYPES.Literal && typeof node.property.value === "string") {
      return node.property.value;
    }
  }
  if (node.type === AST_NODE_TYPES.ChainExpression) {
    return getEnvVarName(node.expression);
  }
  return "ENV_VAR";
}

/**
 * Returns true if node is or transitively contains a parseInt/parseFloat/Number call
 * whose first argument contains a process.env access.
 */
function isEnvIntParseCall(node: TSESTree.Node): boolean {
  if (node.type !== AST_NODE_TYPES.CallExpression) return false;
  const callee = node.callee;

  const isTargetFunction =
    (callee.type === AST_NODE_TYPES.Identifier &&
      (callee.name === "parseInt" || callee.name === "parseFloat" || callee.name === "Number")) ||
    (callee.type === AST_NODE_TYPES.MemberExpression &&
      !callee.computed &&
      callee.object.type === AST_NODE_TYPES.Identifier &&
      callee.object.name === "Number" &&
      callee.property.type === AST_NODE_TYPES.Identifier &&
      (callee.property.name === "parseInt" || callee.property.name === "parseFloat"));

  if (!isTargetFunction) return false;

  const firstArg = node.arguments[0];
  if (!firstArg || firstArg.type === AST_NODE_TYPES.SpreadElement) return false;

  return containsProcessEnv(firstArg);
}

function containsProcessEnv(node: TSESTree.Node): boolean {
  if (isProcessEnvAccess(node)) return true;
  if (node.type === AST_NODE_TYPES.LogicalExpression) {
    return containsProcessEnv(node.left) || containsProcessEnv(node.right);
  }
  if (node.type === AST_NODE_TYPES.CallExpression) {
    // e.g. process.env.FOO?.trim()
    if (node.callee.type === AST_NODE_TYPES.MemberExpression) {
      return containsProcessEnv(node.callee.object);
    }
    return node.arguments.some(a => a.type !== AST_NODE_TYPES.SpreadElement && containsProcessEnv(a));
  }
  if (node.type === AST_NODE_TYPES.ChainExpression) {
    return containsProcessEnv(node.expression);
  }
  return false;
}

export const requireEnvIntNanGuardRule = createRule({
  name: "require-env-int-nan-guard",
  meta: {
    type: "problem",
    hasSuggestions: false,
    docs: {
      description:
        "Disallow using a truthy check on process.env.* as the sole guard before parseInt / parseFloat / Number() " +
        "in a conditional expression. A truthy check (e.g. `process.env.X ? parseInt(process.env.X, 10) : fallback`) " +
        "does NOT protect against non-numeric strings: parseInt('abc', 10) returns NaN, " +
        "and subsequent comparisons like `sizeKB > NaN` silently evaluate to false, bypassing limit checks. " +
        "Use Number.isFinite(n) to validate the parsed result before using it in logic.",
    },
    schema: [],
    messages: {
      requireNaNGuard:
        "process.env.{{envVar}} truthy-guard does not protect against non-numeric strings: " +
        "parseInt / parseFloat / Number() returns NaN for inputs like 'abc', and `x > NaN` is always false. " +
        "Parse the value, then validate with Number.isFinite(n) before use: " +
        "`const n = parseInt(process.env.{{envVar}}, 10); const val = Number.isFinite(n) && n > 0 ? n : DEFAULT;`",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      ConditionalExpression(node) {
        // Pattern: process.env.X ? parseInt(process.env.X, ...) : fallback
        // OR:      !process.env.X ? fallback : parseInt(process.env.X, ...)
        // The test is a simple truthy/falsy check on a process.env access.
        const test = node.test;
        const consequent = node.consequent;
        const alternate = node.alternate;

        let envNode: TSESTree.Node | null = null;
        let parseNode: TSESTree.Node | null = null;

        // Case 1: `process.env.X ? parseInt(process.env.X, ...) : fallback`
        if (isProcessEnvAccess(test) && isEnvIntParseCall(consequent)) {
          envNode = test;
          parseNode = consequent;
        }

        // Case 2: `!process.env.X ? fallback : parseInt(process.env.X, ...)`
        if (
          test.type === AST_NODE_TYPES.UnaryExpression &&
          test.operator === "!" &&
          isProcessEnvAccess(test.argument) &&
          isEnvIntParseCall(alternate)
        ) {
          envNode = test.argument;
          parseNode = alternate;
        }

        if (!envNode || !parseNode) return;

        const envVar = getEnvVarName(envNode);
        context.report({
          node: parseNode,
          messageId: "requireNaNGuard",
          data: { envVar },
        });
      },
    };
  },
});
