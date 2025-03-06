const express = require('express');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
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

// Serve file tĩnh từ thư mục "public"
// (Bạn có thể đặt các file tĩnh như hình ảnh, CSS, JS vào thư mục public)
app.use(express.static(path.join(__dirname, 'public')));

// ----------------------- PHẦN DỮ LIỆU -----------------------

// Đường dẫn file dữ liệu
const dataFilePath = path.join(__dirname, 'data.json');
let cachedData = [];

// Hàm load dữ liệu từ file một cách bất đồng bộ
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

// Tự động reload khi file data.json thay đổi
fs.watch(dataFilePath, (eventType) => {
  if (eventType === 'change') {
    console.log("data.json đã thay đổi, tải lại dữ liệu.");
    loadDataFromFile();
  }
});

// Đường dẫn file dữ liệu người dùng
const usersFilePath = path.join(__dirname, 'users.json');
let usersData = [];

// Hàm load dữ liệu người dùng bất đồng bộ
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

// Tự động reload khi file users.json thay đổi
fs.watch(usersFilePath, (eventType) => {
  if (eventType === 'change') {
    console.log("users.json đã thay đổi, tải lại dữ liệu người dùng.");
    loadUsersData();
  }
});

// ----------------------- API & ROUTE -----------------------

// API trả về dữ liệu cho trang home (dùng cho phân trang/lazy load)
app.get('/api/data', (req, res) => {
  res.json(cachedData);
});

// Middleware bảo vệ route (chỉ cho phép người đã đăng nhập)
function isAuthenticated(req, res, next) {
  if (req.session && req.session.user) {
    next();
  } else {
    res.redirect('/login.html');
  }
}

// ----------------------- API ĐĂNG NHẬP -----------------------

// API đăng nhập sử dụng trường "identifier" (tên hoặc email) và password dạng plain text
app.post('/login', (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) {
    return res.json({ success: false, message: "Vui lòng nhập đủ tên/email và mật khẩu." });
  }

  // Tìm người dùng (không phân biệt chữ hoa/chữ thường)
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

// API đăng xuất: xóa session và chuyển hướng về trang đăng nhập
app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) console.error("Lỗi xóa session:", err);
    res.redirect('/login.html');
  });
});

// ----------------------- ROUTE TRANG HOME -----------------------

// Route bảo vệ cho trang home (file home.html nằm trong thư mục "views")
app.get(['/home', '/home.html'], isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'home.html'));
});

app.listen(port, () => {
  console.log(`Server đang chạy trên cổng ${port}`);
});
