import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4310,
    // The app imports the ui kit straight from ../../ui/registry – the
    // copy-owned files, used in place.
    fs: { allow: [".", "../../ui"] },
  },
});
