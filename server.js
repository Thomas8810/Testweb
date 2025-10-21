const express = require('express');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const cookieSession = require('cookie-session');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const compression = require('compression'); // ✅ nén gzip

const app = express();
const port = process.env.PORT || 3000;
const activeUsers = new Map();

// ---------------- SESSION ----------------
app.use(cookieSession({
  name: 'session',
  keys: ['your-very-secret-key-CHANGE-THIS-PLEASE'],
  maxAge: 24 * 60 * 60 * 1000 // 24h
}));

app.use((req, res, next) => {
  if (req.session?.user) activeUsers.set(req.session.user.name, Date.now());
  next();
});

// ---------------- MIDDLEWARE ----------------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(compression()); // ✅ bật nén toàn site

// ---------------- STATIC FILES ----------------
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '30d', // ✅ cache 30 ngày
  etag: true
}));

// ---------------- SUPABASE ----------------
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
let supabase;

if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log('✅ Supabase initialized');
} else {
  console.warn('⚠️ Supabase not configured — skipping DB features.');
  supabase = {
    from: () => ({
      select: async () => ({ data: [], error: null }),
      insert: async () => ({ data: [], error: null }),
      update: async () => ({ data: [], error: null }),
      delete: async () => ({ data: [], error: null }),
      eq: () => {}, order: () => {}, single: async () => ({ data: null, error: null })
    }),
    storage: { from: () => ({ upload: async () => ({}), remove: async () => ({}), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) }
  };
}

// ---------------- MULTER ----------------
const upload = multer({ storage: multer.memoryStorage() });

// ---------------- LOAD JSON ----------------
let cachedData = [];
let usersData = [];
let headerOrder = [];

function safeRequire(filePath) {
  try {
    delete require.cache[require.resolve(filePath)];
    return require(filePath);
  } catch {
    return [];
  }
}

async function loadData() {
  cachedData = safeRequire('./data.json');
  if (cachedData.length) {
    const headerSet = new Set();
    cachedData.forEach(row => Object.keys(row).forEach(k => headerSet.add(k)));
    headerOrder = [...headerSet];
    console.log(`✅ Loaded ${cachedData.length} records from data.json`);
  }
}
async function loadUsers() {
  usersData = safeRequire('./users.json');
  console.log(`✅ Loaded ${usersData.length} users`);
}
loadData();
loadUsers();

// ---------------- AUTH MIDDLEWARE ----------------
function isAuthenticated(req, res, next) {
  if (req.session?.user) return next();
  res.redirect('/login.html');
}
function isAdmin(req, res, next) {
  if (req.session?.user?.role === 'admin') return next();
  res.status(403).json({ success: false, message: 'Admin privileges required' });
}

// ---------------- LOGIN ----------------
app.post('/login', (req, res) => {
  const { identifier, password } = req.body;
  const user = usersData.find(u =>
    [u.email, u.name].some(id => id?.toLowerCase() === identifier?.toLowerCase())
  );
  if (!user) return res.json({ success: false, message: 'User not found' });
  if (user.password !== password) return res.json({ success: false, message: 'Incorrect password' });
  req.session.user = { name: user.name, email: user.email, role: user.role };
  res.json({ success: true, user: req.session.user });
});

app.get('/logout', (req, res) => {
  req.session = null;
  res.redirect('/login.html');
});

app.get('/api/me', (req, res) => {
  res.json(req.session?.user ? { success: true, user: req.session.user } : { success: false });
});

// ---------------- ACTIVE USERS ----------------
app.get('/api/active-users', isAdmin, (req, res) => {
  const now = Date.now();
  const online = [...activeUsers.entries()]
    .filter(([_, lastSeen]) => now - lastSeen < 2 * 60 * 1000)
    .map(([name]) => name);
  res.json({ success: true, users: online });
});

// ---------------- ROUTES ----------------
app.get('/login.html', (_, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/', isAuthenticated, (_, res) => res.sendFile(path.join(__dirname, 'views', 'home.html')));
app.get(['/home', '/home.html'], isAuthenticated, (_, res) => res.sendFile(path.join(__dirname, 'views', 'home.html')));
app.get(['/tasks', '/tasks.html'], isAuthenticated, (_, res) => res.sendFile(path.join(__dirname, 'views', 'tasks.html')));
app.get(['/voice_search', '/voice_search.html'], isAuthenticated, (_, res) => res.sendFile(path.join(__dirname, 'views', 'voice_search.html')));

// ---------------- DATA SEARCH ----------------
function convertYYYYMMDDToExcelSerial(yyyymmdd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(yyyymmdd)) return null;
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return Math.floor((date - new Date(Date.UTC(1899, 11, 30))) / 86400000);
}

app.get('/api/data', isAuthenticated, (_, res) => res.json(cachedData));

app.get('/filters', isAuthenticated, (_, res) => {
  if (!cachedData.length) return res.json({});
  const values = new Set(cachedData.map(i => i.Customer).filter(Boolean));
  res.json({ Customer: [...values].sort((a, b) => a.localeCompare(b, 'vi')) });
});

app.get('/search', isAuthenticated, (req, res) => {
  let results = [...cachedData];
  const params = req.query;
  const dateCols = ['PO received date', 'Customer need date', 'Submit date'];

  for (const key in params) {
    const val = params[key];
    if (!val) continue;

    const baseKey = key.replace(/_start|_end$/, '');
    if (dateCols.includes(baseKey)) {
      const start = convertYYYYMMDDToExcelSerial(params[`${baseKey}_start`]);
      const end = convertYYYYMMDDToExcelSerial(params[`${baseKey}_end`]);
      results = results.filter(item => {
        const serial = convertYYYYMMDDToExcelSerial(item[baseKey]);
        if (serial == null) return false;
        return (!start || serial >= start) && (!end || serial <= end);
      });
    } else if (!key.endsWith('_start') && !key.endsWith('_end')) {
      const queryVals = val.split(',');
      results = results.filter(item =>
        queryVals.some(q => item[key]?.toString().toLowerCase().includes(q.toLowerCase()))
      );
    }
  }

  const limit = parseInt(params.limit) || 50;
  const offset = parseInt(params.offset) || 0;
  res.json({ data: results.slice(offset, offset + limit), total: results.length });
});

app.get('/export', isAuthenticated, (req, res) => {
  const XLSX = require('xlsx');
  const worksheet = XLSX.utils.json_to_sheet(cachedData, { header: headerOrder });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Results');
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
  res.setHeader('Content-Disposition', 'attachment; filename="exported_data.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

// ---------------- START ----------------
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});

module.exports = app;
