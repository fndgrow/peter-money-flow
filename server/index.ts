import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { seedDefaults, fillCurrencies, migrateIncomeCategories, migrateExpenseCategories, removeSalaryFeature, DB_PATH } from "./db.js";
import { api } from "./routes.js";
import { startRateUpdater } from "./rates.js";
import { startSweepScheduler } from "./sweep.js";
import { broadcastChange, eventsHandler } from "./events.js";
import { isAuthed } from "./auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);

seedDefaults();
fillCurrencies();
migrateIncomeCategories();
migrateExpenseCategories();
removeSalaryFeature();
startRateUpdater();
startSweepScheduler();

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "20mb" }));
app.use(cookieParser());

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  // Private app: tell search engines and crawlers to never index or follow anything.
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
  next();
});

app.get("/robots.txt", (_req, res) => {
  res.type("text/plain").send("User-agent: *\nDisallow: /\n");
});

// Live updates: push a "changed" event after every successful write.
app.use("/api", (req, res, next) => {
  if (req.method !== "GET") {
    res.on("finish", () => {
      if (res.statusCode < 400 && !/^\/(login|logout|setup|password|email)$/.test(req.path)) broadcastChange();
    });
  }
  next();
});
app.get("/api/events", (req, res) => {
  if (!isAuthed(req)) return res.status(401).end();
  eventsHandler(req, res);
});
app.use("/api", api);

// Serve the built client (dist/client) in production.
const clientDir = path.resolve(__dirname, "../client");
if (fs.existsSync(clientDir)) {
  app.use(
    express.static(clientDir, {
      etag: true,
      lastModified: true,
      setHeaders(res, filePath) {
        if (filePath.endsWith("sw.js") || filePath.endsWith("index.html") || filePath.endsWith("manifest.webmanifest")) {
          res.setHeader("Cache-Control", "no-cache");
        } else if (/[\\/]assets[\\/]/.test(filePath)) {
          // Hashed file names: safe to cache for a year.
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else {
          res.setHeader("Cache-Control", "public, max-age=86400");
        }
      },
    }),
  );
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(clientDir, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`My money listening on http://localhost:${PORT}  (db: ${DB_PATH})`);
});
