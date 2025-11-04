import { build, context } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const isWatch = process.argv.includes("--watch");

const tailwindConfigPath = path.join(rootDir, "tailwind.config.mjs");
const tailwindInputPath = path.join(rootDir, "src", "styles", "tailwind.css");

const getTailwindBin = () => {
  const bin = path.join(rootDir, "node_modules", ".bin", process.platform === "win32" ? "tailwindcss.cmd" : "tailwindcss");
  return bin;
};

const buildTailwindOnce = async () => {
  await fs.mkdir(distDir, { recursive: true });

  const tailwindBin = getTailwindBin();
  const args = [
    "-c",
    tailwindConfigPath,
    "-i",
    tailwindInputPath,
    "-o",
    path.join(distDir, "content.css"),
    "--minify",
  ];

  await new Promise((resolve, reject) => {
    const proc = spawn(tailwindBin, args, { stdio: "inherit" });
    proc.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`TailwindCSS exited with code ${code}`));
      }
    });
  });
};

const startTailwindWatch = () => {
  const tailwindBin = getTailwindBin();
  const args = [
    "-c",
    tailwindConfigPath,
    "-i",
    tailwindInputPath,
    "-o",
    path.join(distDir, "content.css"),
    "--minify",
    "--watch",
  ];

  const proc = spawn(tailwindBin, args, { stdio: "inherit" });
  proc.on("exit", (code) => {
    if (code !== 0) {
      console.error(`Tailwind watch exited with code ${code}`);
    }
  });
  return proc;
};

const copyStatic = async () => {
  await fs.mkdir(distDir, { recursive: true });

  // Manifest
  await fs.copyFile(path.join(rootDir, "manifest.json"), path.join(distDir, "manifest.json"));

  // Assets (icons, etc.)
  const assetsSrc = path.join(rootDir, "assets");
  try {
    await fs.rm(path.join(distDir, "assets"), { recursive: true, force: true });
  } catch (error) {
    // noop
  }

  try {
    await fs.cp(assetsSrc, path.join(distDir, "assets"), { recursive: true });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      // assets dir optional
    } else {
      throw error;
    }
  }

  // Credits page
  const creditsSrc = path.join(rootDir, "src", "credits");
  try {
    await fs.rm(path.join(distDir, "credits"), { recursive: true, force: true });
  } catch {
    // noop
  }

  try {
    await fs.cp(creditsSrc, path.join(distDir, "credits"), { recursive: true });
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      throw error;
    }
  }

  // Declarative net-request rules
  const rulesSrc = path.join(rootDir, "rules");
  try {
    await fs.rm(path.join(distDir, "rules"), { recursive: true, force: true });
  } catch {
    // noop
  }

  try {
    await fs.cp(rulesSrc, path.join(distDir, "rules"), { recursive: true });
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      throw error;
    }
  }
};

const buildOptions = {
  entryPoints: [
    path.join(rootDir, "src", "background", "index.ts"),
    path.join(rootDir, "src", "content", "index.ts"),
  ],
  bundle: true,
  splitting: false,
  format: "esm",
  platform: "browser",
  target: ["chrome115"],
  outdir: distDir,
  outbase: path.join(rootDir, "src"),
  sourcemap: true,
  logLevel: "info",
  entryNames: "[dir]",
  define: {
    "process.env.NODE_ENV": JSON.stringify(isWatch ? "development" : "production"),
  },
  plugins: [
    {
      name: "copy-static",
      setup(build) {
        build.onStart(async () => {
          await copyStatic();
          if (!isWatch) {
            await buildTailwindOnce();
          }
        });
      },
    },
  ],
};

const run = async () => {
  if (isWatch) {
    await buildTailwindOnce();
    startTailwindWatch();
    const ctx = await context(buildOptions);
    await ctx.watch();
    console.log("Build watching for changes...");
  } else {
    await build(buildOptions);
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
