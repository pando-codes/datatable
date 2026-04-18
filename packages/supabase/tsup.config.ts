import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [
    "@pando-codes/datatable-contracts",
    "@pando-codes/datatable-core",
    "@pando-codes/datatable-testing",
    "@supabase/supabase-js",
  ],
});
