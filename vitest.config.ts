import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, ".stryker-tmp/**", ".swarm/**", "dist/**"],
    coverage: { provider: "v8", include: ["src/**"], exclude: ["src/**/*.test.ts", "src/cli.ts"], reporter: ["text-summary", "lcov", "json"] },
  },
});
