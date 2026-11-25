import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// SINGLE_FILE=1 → one self-contained index.html (static demo / design review). Default: normal PWA build.
export default defineConfig({
  plugins: [react(), tailwindcss(), ...(process.env.SINGLE_FILE ? [viteSingleFile()] : [])],
  server: { port: 5173, host: true },
});
