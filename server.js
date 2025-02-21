const express = require('express');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const session = require('express-session');
const bcrypt = require('bcrypt');

const app = express();
const port = process.env.PORT || 3000;

// 1) Middleware đọc JSON, xử lý form
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 2) Cấu hình session
app.use(session({
  secret: 'your-secret-key', // Đổi thành chuỗi bí mật riêng
  resave: false,
  saveUninitialized: false
}));

// 3) Cấu hình serve file tĩnh từ thư mục "public"
app.use(express.static(path.join(__dirname, 'public')));

// 4) Đọc dữ liệu cho chức năng tra cứu (data.json)
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
    console.log("Dữ liệu được tải và cache thành công.");
  } catch (err) {
    console.error("Lỗi khi đọc file data.json:", err);
  }
}
loadDataFromFile();

// 5) Đọc & ghi dữ liệu người dùng (users.json)
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
    console.log("Dữ liệu users.json được tải thành công.");
  } catch (err) {
    console.error("Lỗi khi đọc file users.json:", err);
    usersData = [];
  }
}
loadUsersData();

function saveUsersData() {
  fs.writeFileSync(usersFilePath, JSON.stringify(usersData, null, 2), 'utf8');
}

// ------------------- API ĐĂNG KÝ - ĐĂNG NHẬP - QUÊN MẬT KHẨU -------------------

// Đăng ký: Thêm user mới vào users.json (mã hóa mật khẩu)
app.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.json({ success: false, message: "Vui lòng nhập đủ name, email, password." });
  }

  // Kiểm tra email đã tồn tại?
  const existingUser = usersData.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (existingUser) {
    return res.json({ success: false, message: "Email đã được đăng ký." });
  }

  // Mã hóa mật khẩu
  const saltRounds = 10;
  const hashedPassword = await bcrypt.hash(password, saltRounds);

  // Tạo user mới
  const newUser = {
    name: name,
    email: email.toLowerCase(),
    password: hashedPassword,
    role: "user"
  };
  usersData.push(newUser);
  saveUsersData();

  return res.json({ success: true, message: "Đăng ký thành công! Bạn có thể đăng nhập ngay." });
});

// Đăng nhập: So sánh mật khẩu (đã mã hóa)
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.json({ success: false, message: "Vui lòng nhập đủ email và password." });
  }

  const user = usersData.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) {
    return res.json({ success: false, message: "Email không tồn tại." });
  }

  // Kiểm tra mật khẩu bằng bcrypt
  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    return res.json({ success: false, message: "Sai mật khẩu." });
  }

  // Đăng nhập thành công -> lưu session
  req.session.user = {
    name: user.name,
    email: user.email,
    role: user.role
  };
  return res.json({ success: true, message: "Đăng nhập thành công." });
});

// Quên mật khẩu: Người dùng nhập email & mật khẩu mới -> cập nhật luôn
app.post('/forgot-password', async (req, res) => {
  const { email, newPassword } = req.body;
  if (!email || !newPassword) {
    return res.json({ success: false, message: "Vui lòng nhập đủ email và mật khẩu mới." });
  }

  const user = usersData.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) {
    return res.json({ success: false, message: "Email không tồn tại trong hệ thống." });
  }

  // Mã hóa mật khẩu mới
  const saltRounds = 10;
  const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

  user.password = hashedPassword;
  saveUsersData();

  return res.json({ success: true, message: "Cập nhật mật khẩu mới thành công! Hãy đăng nhập lại." });
});

// Middleware kiểm tra đăng nhập
function isAuthenticated(req, res, next) {
  if (req.session && req.session.user) {
    next();
  } else {
    res.redirect('/login.html');
  }
}

// ------------------- CÁC API TÌM KIẾM - XUẤT EXCEL (GIỮ NGUYÊN) -------------------

// Lấy danh sách giá trị lọc (filters)
app.get('/filters', (req, res) => {
  const getDistinct = (col) => {
    const values = cachedData.map(row => row[col]).filter(v => v != null);
    return Array.from(new Set(values));
  };

  res.json({
    "Sheet": getDistinct("Sheet"),
    "PO Number": getDistinct("PO Number"),
    "Project": getDistinct("Project"),
    "Part Number": getDistinct("Part Number"),
    "REV": getDistinct("REV"),
    "Discription": getDistinct("Discription"),
    "Note Number": getDistinct("Note Number"),
    "Critical": getDistinct("Critical"),
    "CE": getDistinct("CE"),
    "Material": getDistinct("Material"),
    "Plating": getDistinct("Plating"),
    "Painting": getDistinct("Painting"),
    "Tiêu chuẩn mạ sơn": getDistinct("Tiêu chuẩn mạ sơn"),
    "Ngày Nhận PO": getDistinct("Ngày Nhận PO"),
    "Cover sheet": getDistinct("Cover sheet"),
    "Drawing": getDistinct("Drawing"),
    "Datasheet form": getDistinct("Datasheet form"),
    "Data": getDistinct("Data"),
    "COC": getDistinct("COC"),
    "BOM": getDistinct("BOM"),
    "Mill": getDistinct("Mill"),
    "Part Pictures": getDistinct("Part Pictures"),
    "Packaging Pictures": getDistinct("Packaging Pictures"),
    "Submit date": getDistinct("Submit date"),
    "Đã lên PO LAM": getDistinct("Đã lên PO LAM"),
    "OK": getDistinct("OK"),
    "Remark": getDistinct("Remark"),
    "Remark 2": getDistinct("Remark 2"),
    "Status": getDistinct("Status"),
    "Note": getDistinct("Note")
  });
});

// Tìm kiếm dữ liệu có phân trang
app.get('/search', (req, res) => {
  let filtered = cachedData;
  const { limit, offset, ...filters } = req.query;

  for (let key in filters) {
    if (filters[key]) {
      const filterValues = filters[key].split(',').map(val => val.trim().toLowerCase());
      filtered = filtered.filter(row => {
        if (row[key]) {
          const cellValue = row[key].toString().toLowerCase();
          return filterValues.some(val => cellValue.includes(val));
        }
        return false;
      });
    }
  }

  const total = filtered.length;
  const pageLimit = parseInt(limit, 10) || 50;
  const pageOffset = parseInt(offset, 10) || 0;
  const paginatedData = filtered.slice(pageOffset, pageOffset + pageLimit);

  res.json({ total, data: paginatedData });
});

// Xuất Excel
app.get('/export', (req, res) => {
  let filtered = cachedData;
  const { limit, offset, ...filters } = req.query;

  for (let key in filters) {
    if (filters[key]) {
      const filterValues = filters[key].split(',').map(val => val.trim().toLowerCase());
      filtered = filtered.filter(row => {
        if (row[key]) {
          const cellValue = row[key].toString().toLowerCase();
          return filterValues.some(val => cellValue.includes(val));
        }
        return false;
      });
    }
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(filtered);
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Disposition', 'attachment; filename=export.xlsx');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.send(buf);
});

// Ví dụ route được bảo vệ
app.get('/dashboard', isAuthenticated, (req, res) => {
  res.send(`Chào mừng ${req.session.user.name || req.session.user.email}, đây là trang dashboard.`);
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
