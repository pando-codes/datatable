import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [
    "@pando/datatable-contracts",
    "@pando/datatable-core",
    "@pando/datatable-testing",
    "@supabase/supabase-js",
  ],
});
