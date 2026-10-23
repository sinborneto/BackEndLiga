import tseslint from "typescript-eslint";
export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "artifacts/**"] },
  ...tseslint.configs.recommended,
);
