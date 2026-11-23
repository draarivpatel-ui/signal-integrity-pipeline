import react from "@vitejs/plugin-react"
import { defineConfig, type UserConfig } from "vite"
import { createSolverMiddleware } from "./src/adapters/solver-middleware"

/** `bun run dev` opens Cosmos on the SI Workbench fixture. */
const WORKBENCH_FIXTURE_URL = `http://127.0.0.1:5000/?fixtureId=${encodeURIComponent(
  JSON.stringify({ path: "pages/si-workbench.page.tsx" }),
)}`

export default defineConfig({
  optimizeDeps: { exclude: ["@resvg/resvg-js"] },
  plugins: [
    react(),
    {
      name: "local-ngspice",
      // Cosmos 6 passes host=0.0.0.0 inline, so enforce loopback after that merge.
      config: (): UserConfig => ({
        preview: { host: "127.0.0.1", cors: false, strictPort: true },
        server: {
          host: "127.0.0.1",
          open: WORKBENCH_FIXTURE_URL,
          strictPort: true,
          cors: false,
          fs: {
            deny: [
              "**/models/**",
              "**/*.ibs",
              "**/*.circuit.json",
              "**/.env*",
              "**/.git/**",
            ],
          },
        },
      }),
      configureServer: (server) => {
        server.middlewares.use(createSolverMiddleware())
      },
      configurePreviewServer: (server) => {
        server.middlewares.use(createSolverMiddleware())
      },
    },
  ],
})
