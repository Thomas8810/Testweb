const express = require("express");
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const cookieSession = require("cookie-session");
const { createClient } = require("@supabase/supabase-js");
const multer = require("multer");
const compression = require("compression");

const app = express();
const port = process.env.PORT || 3000;

// ---------------- SESSION ----------------
app.use(cookieSession({
  name: "session",
  keys: ["secret-key-change-me"],
  maxAge: 24 * 60 * 60 * 1000,
}));

// ---------------- MIDDLEWARE ----------------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(compression());

// ---------------- STATIC FILES ----------------
app.use(express.static(path.join(__dirname, "public"), {
  maxAge: "30d",
  etag: true
}));

// ---------------- SUPABASE (tùy chọn) ----------------
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
let supabase = null;
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log("✅ Supabase connected");
} else {
  console.warn("⚠️ Supabase not configured");
}

// ---------------- LOAD JSON ----------------
function loadJSON(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const data = fs.readFileSync(filePath, "utf8");
    return JSON.parse(data || "[]");
  } catch (err) {
    console.error(`❌ Error loading ${filePath}:`, err.message);
    return [];
  }
}

const dataPath = path.join(__dirname, "data.json");
const usersPath = path.join(__dirname, "users.json");

let cachedData = loadJSON(dataPath);
let usersData = loadJSON(usersPath);

console.log(`✅ Loaded ${cachedData.length} records from data.json`);
console.log(`✅ Loaded ${usersData.length} users from users.json`);

// ---------------- AUTH ----------------
function isAuthenticated(req, res, next) {
  if (req.session?.user) return next();
  res.redirect("/login.html");
}
function isAdmin(req, res, next) {
  if (req.session?.user?.role === "admin") return next();
  res.status(403).json({ success: false, message: "Admin privileges required" });
}

// ---------------- LOGIN ----------------
app.post("/login", (req, res) => {
  const { identifier, password } = req.body;
  const user = usersData.find(u =>
    [u.email, u.name].some(id => id?.toLowerCase() === identifier?.toLowerCase())
  );
  if (!user) return res.json({ success: false, message: "User not found" });
  if (user.password !== password) return res.json({ success: false, message: "Incorrect password" });

  req.session.user = { name: user.name, email: user.email, role: user.role };
  res.json({ success: true, user: req.session.user });
});

app.get("/logout", (req, res) => {
  req.session = null;
  res.redirect("/login.html");
});

app.get("/api/me", (req, res) => {
  if (req.session?.user) res.json({ success: true, user: req.session.user });
  else res.json({ success: false });
});

// ---------------- ROUTES ----------------
app.get("/login.html", (_, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
app.get("/", isAuthenticated, (_, res) => res.sendFile(path.join(__dirname, "views", "home.html")));
app.get(["/home", "/home.html"], isAuthenticated, (_, res) => res.sendFile(path.join(__dirname, "views", "home.html")));
app.get(["/tasks", "/tasks.html"], isAuthenticated, (_, res) => res.sendFile(path.join(__dirname, "views", "tasks.html")));
app.get(["/voice_search", "/voice_search.html"], isAuthenticated, (_, res) => res.sendFile(path.join(__dirname, "views", "voice_search.html")));

// ---------------- SEARCH ----------------
function convertYYYYMMDDToExcelSerial(yyyymmdd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(yyyymmdd)) return null;
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return Math.floor((date - new Date(Date.UTC(1899, 11, 30))) / 86400000);
}

app.get("/api/data", isAuthenticated, (_, res) => res.json(cachedData));

app.get("/search", isAuthenticated, (req, res) => {
  let results = [...cachedData];
  const params = req.query;
  const dateCols = ["PO received date", "Customer need date", "Submit date"];

  for (const key in params) {
    const val = params[key];
    if (!val) continue;

    const baseKey = key.replace(/_start|_end$/, "");
    if (dateCols.includes(baseKey)) {
      const start = convertYYYYMMDDToExcelSerial(params[`${baseKey}_start`]);
      const end = convertYYYYMMDDToExcelSerial(params[`${baseKey}_end`]);
      results = results.filter(item => {
        const serial = convertYYYYMMDDToExcelSerial(item[baseKey]);
        if (serial == null) return false;
        return (!start || serial >= start) && (!end || serial <= end);
      });
    } else if (!key.endsWith("_start") && !key.endsWith("_end")) {
      const queryVals = val.split(",");
      results = results.filter(item =>
        queryVals.some(q => item[key]?.toString().toLowerCase().includes(q.toLowerCase()))
      );
    }
  }

  const limit = parseInt(params.limit) || 50;
  const offset = parseInt(params.offset) || 0;
  res.json({ data: results.slice(offset, offset + limit), total: results.length });
});

app.get("/export", isAuthenticated, (req, res) => {
  const worksheet = XLSX.utils.json_to_sheet(cachedData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Results");
  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });

  res.setHeader("Content-Disposition", "attachment; filename=\"export.xlsx\"");
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.send(buffer);
});

// ---------------- START ----------------
if (process.env.VERCEL !== "1") {
  app.listen(port, () => console.log(`🚀 Server running on port ${port}`));
}

module.exports = app;
