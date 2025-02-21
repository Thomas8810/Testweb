const express = require('express');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const session = require('express-session');
const nodemailer = require('nodemailer');

const app = express();
const port = process.env.PORT || 3000;

// Setup middleware xử lý dữ liệu POST
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Setup session
app.use(session({
  secret: 'your-secret-key', // thay đổi secret cho phù hợp
  resave: false,
  saveUninitialized: false,
}));

// Thiết lập thư mục tĩnh cho frontend (các file HTML, CSS, JS trong folder public)
app.use(express.static(path.join(__dirname, 'public')));

// Load dữ liệu từ file data.json (cho chức năng tìm kiếm, lọc,...)
const dataFilePath = path.join(__dirname, 'data.json');
let cachedData = [];
function loadDataFromFile() {
  try {
    const fileData = fs.readFileSync(dataFilePath, 'utf8');
    cachedData = JSON.parse(fileData);
    console.log("Dữ liệu được tải và cache thành công.");
  } catch (err) {
    console.error("Lỗi khi đọc file data.json:", err);
  }
}
loadDataFromFile();

// Load dữ liệu người dùng từ file users.json (chứa thông tin đăng nhập, phân quyền)
const usersFilePath = path.join(__dirname, 'users.json');
let usersData = [];
function loadUsersData() {
  try {
    if (fs.existsSync(usersFilePath)) {
      const fileData = fs.readFileSync(usersFilePath, 'utf8');
      usersData = JSON.parse(fileData);
    } else {
      usersData = []; // Nếu file chưa tồn tại thì khởi tạo mảng rỗng
    }
  } catch (err) {
    console.error("Lỗi khi đọc file users.json:", err);
  }
}
loadUsersData();

// Hàm lưu lại dữ liệu người dùng
function saveUsersData() {
  fs.writeFileSync(usersFilePath, JSON.stringify(usersData, null, 2), 'utf8');
}

// Cấu hình nodemailer (ví dụ sử dụng Gmail)
// Hãy thiết lập các biến môi trường: EMAIL_USER, EMAIL_PASS, ADMIN_EMAIL
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER, // email của bạn
    pass: process.env.EMAIL_PASS  // mật khẩu hoặc app password
  }
});

// Endpoint đăng nhập
app.post('/login', (req, res) => {
  const { name, password } = req.body;
  // Xác thực theo tên (không phân biệt chữ hoa chữ thường)
  const user = usersData.find(u => u.name.toLowerCase() === name.toLowerCase() && u.password === password);
  if (user) {
    req.session.user = {
      name: user.name,
      email: user.email,
      role: user.role || 'user'
    };
    res.json({ success: true, message: "Đăng nhập thành công." });
  } else {
    res.json({ success: false, message: "Tên hoặc mật khẩu không đúng." });
  }
});


// Endpoint đăng ký (chỉ gửi yêu cầu về cho admin để kiểm duyệt)
app.post('/register', (req, res) => {
  const { name, email, password } = req.body;
  // Kiểm tra nếu email đã tồn tại
  if (usersData.find(u => u.email === email)) {
    return res.json({ success: false, message: "Email đã được đăng ký." });
  }
  // Gửi email thông báo yêu cầu đăng ký cho admin
  const adminEmail = process.env.ADMIN_EMAIL || 'thomasjessehill8@gmail.com';
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: adminEmail,
    subject: 'Yêu cầu đăng ký tài khoản mới',
    text: `Yêu cầu đăng ký từ:\nHọ tên: ${name}\nEmail: ${email}\nMật khẩu: ${password}\n\nVui lòng kiểm duyệt và thêm tài khoản nếu hợp lệ.`
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error("Lỗi gửi email đăng ký:", error);
      res.json({ success: false, message: "Gửi yêu cầu đăng ký không thành công." });
    } else {
      res.json({ success: true, message: "Yêu cầu đăng ký đã được gửi. Vui lòng chờ xác nhận." });
    }
  });
});

// Endpoint quên mật khẩu (gửi yêu cầu về cho admin)
app.post('/forgot-password', (req, res) => {
  const { email } = req.body;
  // Kiểm tra nếu email tồn tại
  const user = usersData.find(u => u.email === email);
  if (!user) {
    return res.json({ success: false, message: "Email không tồn tại trong hệ thống." });
  }
  // Gửi email thông báo yêu cầu đặt lại mật khẩu cho admin
  const adminEmail = process.env.ADMIN_EMAIL || 'thomasjessehill8@gmail.com';
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: adminEmail,
    subject: 'Yêu cầu đặt lại mật khẩu',
    text: `Yêu cầu đặt lại mật khẩu từ:\nEmail: ${email}\n\nVui lòng kiểm duyệt và cập nhật mật khẩu nếu hợp lệ.`
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error("Lỗi gửi email quên mật khẩu:", error);
      res.json({ success: false, message: "Gửi yêu cầu quên mật khẩu không thành công." });
    } else {
      res.json({ success: true, message: "Yêu cầu quên mật khẩu đã được gửi. Vui lòng chờ xác nhận." });
    }
  });
});

// Middleware bảo vệ các route cần đăng nhập
function isAuthenticated(req, res, next) {
  if (req.session && req.session.user) {
    next();
  } else {
    res.redirect('/login.html');
  }
}

// --- Các API hiện có ---
// API lấy danh sách giá trị lọc (filters)
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

// API tìm kiếm dữ liệu với phân trang
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

// API xuất dữ liệu đã lọc sang file Excel
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

// Ví dụ route được bảo vệ (cho các trang mở rộng sau này)
app.get('/dashboard', isAuthenticated, (req, res) => {
  res.send(`Chào mừng ${req.session.user.name || req.session.user.email}, đây là trang dashboard.`);
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
