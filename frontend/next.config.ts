import type { NextConfig } from "next";
import path from "path";

const SDK_ROOT = path.resolve("./node_modules/@stellar/stellar-sdk");
const SDK_LIB  = path.join(SDK_ROOT, "lib");

const nextConfig: NextConfig = {
  // Transpile TypeScript source packages (no pre-built dist)
  // Webpack handles XDR's .switch() method correctly; Turbopack does not.
  transpilePackages: ["passkey-kit", "passkey-kit-sdk", "sac-sdk"],
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,

      // Force all @stellar/stellar-sdk subpath imports to the root v15 copy.
      // passkey-kit ships a nested v14 copy whose config.js breaks at build time.
      // $ suffix = exact-match only (prevents prefix-match stomping subpaths).
      "@stellar/stellar-sdk$":                     path.join(SDK_LIB, "index.js"),
      "@stellar/stellar-sdk/minimal$":             path.join(SDK_LIB, "minimal/index.js"),
      "@stellar/stellar-sdk/minimal/contract$":    path.join(SDK_LIB, "minimal/contract/index.js"),
      "@stellar/stellar-sdk/minimal/rpc$":         path.join(SDK_LIB, "minimal/rpc/index.js"),
      "@stellar/stellar-sdk/contract$":            path.join(SDK_LIB, "contract/index.js"),
      "@stellar/stellar-sdk/rpc$":                 path.join(SDK_LIB, "rpc/index.js"),

      // Stub out the CLI code-gen helper — it requires ../../package.json
      // (a relative path that doesn't exist from lib/minimal/bindings/) and is
      // never used in browser code.
      [path.join(SDK_LIB, "minimal/bindings/config.js")]: false,
      [path.join(SDK_LIB, "bindings/config.js")]:         false,
    };
    return config;
  },
};

export default nextConfig;
