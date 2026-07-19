// Uses eslint's RuleTester rather than @typescript-eslint/rule-tester, matching the
// convention of all other rule tests in this package. The rule uses @typescript-eslint/utils
// internally but the standard eslint RuleTester is sufficient for all test scenarios here.
import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import { requireEnvIntNanGuardRule } from "./require-env-int-nan-guard";

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "commonjs",
  },
});

describe("require-env-int-nan-guard", () => {
  it("valid and invalid cases", () => {
    ruleTester.run("require-env-int-nan-guard", requireEnvIntNanGuardRule, {
      valid: [
        // Number.isFinite guard: no ternary truthy check — safe
        `const n = parseInt(process.env.MAX_SIZE || "", 10); const val = Number.isFinite(n) && n > 0 ? n : 1024;`,
        // Explicit numeric fallback via || — the string "0" ensures parseInt never sees undefined
        `const port = parseInt(process.env.PORT || "3001", 10); startServer(port);`,
        // Not an env var — plain string literal
        `const n = parseInt("42", 10); if (n > 10) doSomething();`,
        // Number() without ternary truthy check
        `const minutes = Number(process.env.GH_AW_TIMEOUT_MINUTES); if (!Number.isFinite(minutes)) return null;`,
        // Ternary where the test is NOT a process.env access
        `const n = x > 0 ? parseInt(process.env.FOO, 10) : 0;`,
        // Ternary with explicit fallback for missing env (not an env truthy check on same var)
        `const maxSize = parseInt(process.env.MAX_SIZE ?? "10240", 10);`,
      ],

      invalid: [
        // Classic truthy-guard without NaN protection (the bug in safe_outputs_handlers.cjs)
        {
          code: `const maxSizeKB = process.env.GH_AW_ASSETS_MAX_SIZE_KB ? parseInt(process.env.GH_AW_ASSETS_MAX_SIZE_KB, 10) : 10240;`,
          errors: [{ messageId: "requireNaNGuard" }],
        },
        // Negated truthy check
        {
          code: `const n = !process.env.TIMEOUT ? 30 : parseFloat(process.env.TIMEOUT);`,
          errors: [{ messageId: "requireNaNGuard" }],
        },
        // Number() in truthy ternary
        {
          code: `const minutes = process.env.GH_AW_TIMEOUT_MINUTES ? Number(process.env.GH_AW_TIMEOUT_MINUTES) : 30;`,
          errors: [{ messageId: "requireNaNGuard" }],
        },
        // Number.parseInt in truthy ternary
        {
          code: `const count = process.env.MAX_COUNT ? Number.parseInt(process.env.MAX_COUNT, 10) : 100;`,
          errors: [{ messageId: "requireNaNGuard" }],
        },
      ],
    });
  });
});
