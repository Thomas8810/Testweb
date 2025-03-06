const express = require('express');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const session = require('express-session');
const compression = require('compression');

const app = express();
const port = process.env.PORT || 3000;

// Middleware để parse JSON và dữ liệu form
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sử dụng compression để nén phản hồi
app.use(compression());

// Bật cache cho các file tĩnh trong thư mục public (cache 7 ngày)
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '7d'
}));

// ----------------------- PHẦN DỮ LIỆU -----------------------

// Đọc dữ liệu tra cứu từ file data.json
const dataFilePath = path.join(__dirname, 'data.json');
let cachedData = [];
function loadDataFromFile() {
  try {
    if (fs.existsSync(dataFilePath)) {
      const fileData = fs.readFileSync(dataFilePath, 'utf8');
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

// Đọc dữ liệu người dùng từ file users.json
const usersFilePath = path.join(__dirname, 'users.json');
let usersData = [];
function loadUsersData() {
  try {
    if (fs.existsSync(usersFilePath)) {
      const fileData = fs.readFileSync(usersFilePath, 'utf8');
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

// ----------------------- SESSION -----------------------
app.use(session({
  secret: 'your-secret-key', // Thay đổi thành chuỗi bí mật riêng của bạn
  resave: false,
  saveUninitialized: false
}));

// ----------------------- MIDDLEWARE BẢO VỆ ROUTE -----------------------
function isAuthenticated(req, res, next) {
  if (req.session && req.session.user) {
    next();
  } else {
    res.redirect('/login.html');
  }
}

// ----------------------- API ĐĂNG NHẬP -----------------------
app.post('/login', (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) {
    return res.json({ success: false, message: "Vui lòng nhập đủ tên/email và mật khẩu." });
  }

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

  req.session.user = {
    name: user.name,
    email: user.email,
    role: user.role
  };

  return res.json({ success: true, message: "Đăng nhập thành công." });
});

app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) console.error("Lỗi xóa session:", err);
    res.redirect('/login.html');
  });
});

// ----------------------- PHÂN TRANG DỮ LIỆU -----------------------
// Endpoint này trả về dữ liệu theo từng trang; bảo vệ bằng middleware isAuthenticated
app.get('/api/data', isAuthenticated, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + limit;

  const slicedData = cachedData.slice(startIndex, endIndex);

  res.json({
    total: cachedData.length,
    data: slicedData
  });
});

// ----------------------- SERVE CÁC TRANG HTML -----------------------
// Trang Home được bảo vệ, nằm trong thư mục views
app.get(['/home', '/home.html'], isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'home.html'));
});

// Trang index (welcome)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Khởi chạy server
app.listen(port, () => {
  console.log(`Server đang chạy tại http://localhost:${port}`);
});
