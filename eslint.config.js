import fs from "node:fs";
import path from "node:path";
import eslintJs from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import globals from "globals";
import tseslint from "typescript-eslint";

const MAX_LINE_LENGTH = 140;

// Loop indices and pixel coordinates, short real words, and the node:fs and node:os imports.
const SHORT_NAMES = ["i", "j", "x", "y", "id", "ok", "fs", "os"];
const MIN_NAME_LENGTH = 3;

const codeRules = {
  "id-length": ["error", { min: MIN_NAME_LENGTH, exceptions: SHORT_NAMES, properties: "never" }],
  "no-empty": ["error", { allowEmptyCatch: false }],
  "eqeqeq": ["error", "always", { null: "ignore" }],
  "prefer-const": "error",
};

// Formatting that is checked and fixed, without reflowing statements: line breaks inside a
// statement are left to the author.
function formatting(indent, commaDangle) {
  return {
    ...stylistic.configs.customize({ indent, quotes: "double", semi: true, commaDangle, braceStyle: "1tbs", arrowParens: true }).rules,
    "@stylistic/max-len": ["error", { code: MAX_LINE_LENGTH, ignoreStrings: true, ignoreTemplateLiterals: true, ignoreRegExpLiterals: true }],
    // Arguments, parameters and literal entries broken over lines may hang one level in or align
    // with the first one.
    "@stylistic/indent": ["error", indent, {
      SwitchCase: 1,
      ArrayExpression: "off",
      ObjectExpression: "off",
      CallExpression: { arguments: "off" },
      FunctionDeclaration: { parameters: "off" },
      FunctionExpression: { parameters: "off" },
    }],
    "@stylistic/list-style": "off",
    "@stylistic/operator-linebreak": "off",
    "@stylistic/indent-binary-ops": "off",
    "@stylistic/multiline-ternary": "off",
    "@stylistic/max-statements-per-line": "off",
    "@stylistic/quotes": ["error", "double", { avoidEscape: true, allowTemplateLiterals: "always" }],
  };
}

// PixInsight's scripting API, as used by pjsr/.
const PIXINSIGHT_GLOBALS = [
  "console",
  "Control",
  "Dialog",
  "File",
  "FileInfo",
  "gc",
  "HistogramTransformation",
  "ImageWindow",
  "IntegerResample",
  "processEvents",
  "ProcessInstance",
  "Rect",
  "Timer",
  "View",
];

// The pjsr/ files are joined into one bundle, so each one calls functions and reads variables the
// others declare. Those top level names are collected here, which keeps no-undef on for typos.
// Group 1 of the pattern is the declared name.
const TOP_LEVEL_DECLARATION = /^(?:function|var) ([A-Za-z_$][\w$]*)/gm;
const pjsrDir = path.join(import.meta.dirname, "pjsr");
const pjsrDeclarations = fs
  .readdirSync(pjsrDir)
  .filter((name) => name.endsWith(".js"))
  .flatMap((name) => [...fs.readFileSync(path.join(pjsrDir, name), "utf8").matchAll(TOP_LEVEL_DECLARATION)])
  .map((match) => match[1]);

const asGlobals = (names) => Object.fromEntries(names.map((name) => [name, "readonly"]));

export default tseslint.config(
  { ignores: ["build/", "data/", "node_modules/"] },
  {
    files: ["src/**/*.ts"],
    extends: [eslintJs.configs.recommended, ...tseslint.configs.recommended],
    plugins: { "@stylistic": stylistic },
    rules: { ...codeRules, ...formatting(2, "always-multiline") },
  },
  {
    files: ["scripts/**/*.mjs", "test/**/*.mjs", "eslint.config.js"],
    extends: [eslintJs.configs.recommended],
    plugins: { "@stylistic": stylistic },
    languageOptions: { globals: globals.node },
    rules: { ...codeRules, ...formatting(2, "always-multiline") },
  },
  {
    files: ["pjsr/**/*.js"],
    extends: [eslintJs.configs.recommended],
    plugins: { "@stylistic": stylistic },
    languageOptions: {
      // PixInsight rejects trailing commas in calls and parameters (ES2017), which this version
      // makes a parse error.
      ecmaVersion: 2016,
      sourceType: "script",
      globals: { ...asGlobals(PIXINSIGHT_GLOBALS), ...asGlobals(pjsrDeclarations) },
    },
    rules: {
      ...codeRules,
      ...formatting(3, "never"),
      // Every top level declaration is used from another file of the bundle.
      "no-unused-vars": ["error", { vars: "local" }],
      // Each file declares names this config lists as globals, and loop counters are var.
      "no-redeclare": "off",
      // Top level declarations stay var: every -x script runs in one persistent global scope,
      // where a repeated top level const or let throws.
      "no-var": "off",
      "prefer-const": "off",
      // The bundle also runs on the legacy engine (scripts without #engine v8), which rejects these
      // though the parser version allows them.
      "no-restricted-syntax": ["error",
        { selector: "TemplateLiteral", message: "The legacy engine rejects template literals." },
        { selector: ":matches(ClassDeclaration, ClassExpression)", message: "The legacy engine rejects class." }],
    },
  },
);
