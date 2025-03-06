const express = require('express');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const session = require('express-session');

const app = express();
const port = process.env.PORT || 3000;

// Middleware để parse JSON và dữ liệu form
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cấu hình session (lưu trong bộ nhớ – in-memory store)
app.use(session({
  secret: 'your-secret-key', // Thay đổi thành chuỗi bí mật riêng của bạn
  resave: false,
  saveUninitialized: false
}));

// Serve file tĩnh từ thư mục "public"
app.use(express.static(path.join(__dirname, 'public')));

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

// ----------------------- MIDDLEWARE BẢO VỆ ROUTE -----------------------

function isAuthenticated(req, res, next) {
  if (req.session && req.session.user) {
    next();
  } else {
    // Nếu chưa đăng nhập, chuyển hướng về trang đăng nhập
    res.redirect('/login.html');
  }
}

// ----------------------- API ĐĂNG NHẬP -----------------------

// Endpoint đăng nhập: sử dụng trường "identifier" để nhập Tên hoặc Email và password dạng plain text
app.post('/login', (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) {
    return res.json({ success: false, message: "Vui lòng nhập đủ tên/email và mật khẩu." });
  }

  // Tìm người dùng theo email hoặc tên (không phân biệt chữ hoa/chữ thường)
  const user = usersData.find(u =>
    u.email.toLowerCase() === identifier.toLowerCase() ||
    u.name.toLowerCase() === identifier.toLowerCase()
  );

  if (!user) {
    return res.json({ success: false, message: "Người dùng không tồn tại." });
  }

  // So sánh mật khẩu dạng plain text
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

// Endpoint đăng xuất: Xóa session và chuyển hướng về trang đăng nhập
app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error("Lỗi xóa session:", err);
    }
    res.redirect('/login.html');
  });
});

// ----------------------- ROUTE BẢO VỆ TRANG HOME -----------------------

// Route bảo vệ cho trang Home, file home.html nằm trong thư mục "views"
app.get('/home', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'home.html'));
});

// Cũng cho phép truy cập qua đường dẫn /home.html nếu cần
app.get('/home.html', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'home.html'));
});

// ----------------------- CÁC API TRA CỨU & XUẤT EXCEL (GIỮ NGUYÊN) -----------------------

// API lấy danh sách giá trị lọc
app.get('/filters', (req, res) => {
  const getDistinct = (col) => {
    const values = cachedData.map(row => row[col]).filter(v => v != null);
    return Array.from(new Set(values));
  };

  res.json({
    "Sheet": getDistinct("Sheet"),
    "PO Number": getDistinct("PO Number"),
    "Project": getDistinct("Project"),
    "Part Number": getDistinct("Part Number")
  });
});

// API xuất file Excel
app.get('/export', (req, res) => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(cachedData);
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const filePath = path.join(__dirname, 'public', 'export.xlsx');
  XLSX.writeFile(wb, filePath);
  res.download(filePath);
});

// ----------------------- START SERVER -----------------------

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
