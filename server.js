// server.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const session = require('express-session');

const app = express();
const port = process.env.PORT || 3000;

// Middleware parse JSON và dữ liệu form
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cấu hình session (lưu trong bộ nhớ – in-memory store)
app.use(session({
  secret: 'your-secret-key', // Thay đổi thành chuỗi bí mật riêng của bạn
  resave: false,
  saveUninitialized: false
}));

// Serve file tĩnh từ thư mục "public" (cho các file CSS, JS, hình ảnh,…)
app.use(express.static(path.join(__dirname, 'public')));

// ----------------------- PHẦN DỮ LIỆU -----------------------

// Biến lưu trữ dữ liệu tra cứu và người dùng
const dataFilePath = path.join(__dirname, 'data.json');
let cachedData = [];

const usersFilePath = path.join(__dirname, 'users.json');
let usersData = [];

// Hàm load dữ liệu từ file data.json một cách bất đồng bộ
async function loadDataFromFile() {
  try {
    if (fs.existsSync(dataFilePath)) {
      const fileData = await fs.promises.readFile(dataFilePath, 'utf8');
      cachedData = JSON.parse(fileData);
    } else {
      cachedData = [];
    }
    console.log("Dữ liệu tra cứu đã được tải thành công.");
  } catch (err) {
    console.error("Lỗi đọc data.json:", err);
  }
}
loadDataFromFile();

// Theo dõi thay đổi của file data.json để tự động reload
fs.watch(dataFilePath, (eventType) => {
  if (eventType === 'change') {
    console.log("data.json đã thay đổi, tải lại dữ liệu.");
    loadDataFromFile();
  }
});

// Hàm load dữ liệu người dùng từ file users.json một cách bất đồng bộ
async function loadUsersData() {
  try {
    if (fs.existsSync(usersFilePath)) {
      const fileData = await fs.promises.readFile(usersFilePath, 'utf8');
      usersData = JSON.parse(fileData);
    } else {
      usersData = [];
    }
    console.log("Dữ liệu người dùng đã được tải thành công.");
  } catch (err) {
    console.error("Lỗi đọc users.json:", err);
    usersData = [];
  }
}
loadUsersData();

// Theo dõi thay đổi của file users.json để tự động reload
fs.watch(usersFilePath, (eventType) => {
  if (eventType === 'change') {
    console.log("users.json đã thay đổi, tải lại dữ liệu người dùng.");
    loadUsersData();
  }
});

// ----------------------- ENDPOINTS & ROUTES -----------------------

// Endpoint /api/data: trả về toàn bộ dữ liệu (nếu cần)
app.get('/api/data', (req, res) => {
  res.json(cachedData);
});

// Endpoint /search: xử lý lọc và phân trang dữ liệu
app.get('/search', (req, res) => {
  let { limit, offset, ...filters } = req.query;
  limit = parseInt(limit) || 50;
  offset = parseInt(offset) || 0;

  // Lọc dữ liệu theo các tham số
  let results = cachedData.filter(row => {
    return Object.keys(filters).every(key => {
      // Nếu giá trị filter không có, bỏ qua
      if (!filters[key]) return true;
      // Nếu giá trị filter có dạng chuỗi các giá trị cách nhau bằng dấu phẩy
      let filterValues = filters[key].split(',').map(v => v.trim().toLowerCase());
      let cellVal = row[key] ? row[key].toString().toLowerCase() : "";
      // Chọn nếu cellVal chứa ít nhất 1 trong các giá trị filter
      return filterValues.some(v => cellVal.includes(v));
    });
  });
  const total = results.length;
  results = results.slice(offset, offset + limit);
  res.json({ total, data: results });
});

// Endpoint /filters: trả về danh sách các giá trị distinct cho cột "Sheet"
app.get('/filters', (req, res) => {
  const sheets = Array.from(new Set(cachedData.map(row => row['Sheet']).filter(Boolean)));
  res.json({ 'Sheet': sheets });
});

// Middleware bảo vệ route: chỉ cho phép người dùng đã đăng nhập truy cập
function isAuthenticated(req, res, next) {
  if (req.session && req.session.user) {
    next();
  } else {
    res.redirect('/login.html');
  }
}

// ----------------------- API ĐĂNG NHẬP -----------------------

// Endpoint đăng nhập: sử dụng trường "identifier" (tên hoặc email) và mật khẩu dạng plain text
app.post('/login', (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) {
    return res.json({ success: false, message: "Vui lòng nhập đủ tên/email và mật khẩu." });
  }

  // Tìm người dùng không phân biệt chữ hoa/chữ thường
  const user = usersData.find(u =>
    u.email.toLowerCase() === identifier.toLowerCase() ||
    u.name.toLowerCase() === identifier.toLowerCase()
  );

  if (!user) {
    return res.json({ success: false, message: "Người dùng không tồn tại." });
  }
  if (user.password !== password) {
    return res.json({ success: false, message: "Sai mật khẩu." });
  }

  // Lưu thông tin đăng nhập vào session
  req.session.user = {
    name: user.name,
    email: user.email,
    role: user.role
  };
  return res.json({ success: true, message: "Đăng nhập thành công." });
});

// Endpoint đăng xuất: hủy session và chuyển hướng về trang đăng nhập
app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) console.error("Lỗi xóa session:", err);
    res.redirect('/login.html');
  });
});

// Route bảo vệ cho trang home (file home.html nằm trong thư mục "views")
app.get(['/home', '/home.html'], isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'home.html'));
});

app.listen(port, () => {
  console.log(`Server đang chạy trên cổng ${port}`);
});
