import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  root: "web", // Set the root directory to the `web` subdirectory
  plugins: [react()],
});
