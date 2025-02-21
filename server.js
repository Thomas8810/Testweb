const express = require('express');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const session = require('express-session');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');

const app = express();
const port = process.env.PORT || 3000;

// Middleware xử lý JSON và form data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cấu hình session
app.use(session({
  secret: 'your-secret-key', // Thay đổi secret cho riêng bạn
  resave: false,
  saveUninitialized: false
}));

// Serve file tĩnh từ thư mục "public"
app.use(express.static(path.join(__dirname, 'public')));

// Cấu hình nodemailer (ví dụ sử dụng Gmail)
// Bạn cần thiết lập biến môi trường: EMAIL_USER, EMAIL_PASS
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER, // Email gửi đi
    pass: process.env.EMAIL_PASS  // Mật khẩu hoặc app password
  }
});

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
    console.log("Dữ liệu được tải và cache thành công.");
  } catch (err) {
    console.error("Lỗi khi đọc file data.json:", err);
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

// Đăng ký: Gửi thông tin đăng ký qua email cho admin
app.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.json({ success: false, message: "Vui lòng nhập đủ name, email, password." });
  }

  // Kiểm tra nếu email đã tồn tại
  const existingUser = usersData.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (existingUser) {
    return res.json({ success: false, message: "Email đã được đăng ký." });
  }

  // Lấy email của admin từ usersData (nếu có tài khoản admin) hoặc dùng biến môi trường ADMIN_EMAIL
  const adminUser = usersData.find(u => u.role === 'admin');
  const adminEmail = adminUser ? adminUser.email : (process.env.ADMIN_EMAIL || 'admin@example.com');

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: adminEmail,
    subject: 'Yêu cầu đăng ký tài khoản mới',
    text: `Yêu cầu đăng ký từ:\nHọ tên: ${name}\nEmail: ${email}\nMật khẩu: ${password}\n\nThông tin đã được gửi cho admin. Vui lòng liên hệ với admin hoặc đăng nhập lại sau 1h sau khi admin cập nhật.`
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error("Lỗi gửi email đăng ký:", error);
      return res.json({ success: false, message: "Gửi yêu cầu đăng ký không thành công." });
    } else {
      return res.json({ success: true, message: "Thông tin đã được gửi cho admin. Vui lòng liên hệ với admin hoặc đăng nhập lại sau 1h." });
    }
  });
});

// Đăng nhập: Sử dụng trường "identifier" để nhận Tên hoặc Email
app.post('/login', async (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) {
    return res.json({ success: false, message: "Vui lòng nhập đủ tên/email và mật khẩu." });
  }

  // Tìm user theo email hoặc tên (không phân biệt chữ hoa chữ thường)
  const user = usersData.find(u =>
    u.email.toLowerCase() === identifier.toLowerCase() ||
    u.name.toLowerCase() === identifier.toLowerCase()
  );
  if (!user) {
    return res.json({ success: false, message: "Người dùng không tồn tại." });
  }

  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    return res.json({ success: false, message: "Sai mật khẩu." });
  }

  req.session.user = {
    name: user.name,
    email: user.email,
    role: user.role
  };
  return res.json({ success: true, message: "Đăng nhập thành công." });
});

// Quên mật khẩu: Gửi yêu cầu đổi mật khẩu qua email cho admin
app.post('/forgot-password', async (req, res) => {
  const { email, newPassword } = req.body;
  if (!email || !newPassword) {
    return res.json({ success: false, message: "Vui lòng nhập đủ email và mật khẩu mới." });
  }

  // Kiểm tra email có tồn tại trong hệ thống không
  const user = usersData.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) {
    return res.json({ success: false, message: "Email không tồn tại trong hệ thống." });
  }

  const adminUser = usersData.find(u => u.role === 'admin');
  const adminEmail = adminUser ? adminUser.email : (process.env.ADMIN_EMAIL || 'admin@example.com');

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: adminEmail,
    subject: 'Yêu cầu đặt lại mật khẩu',
    text: `Yêu cầu đặt lại mật khẩu từ:\nEmail: ${email}\nMật khẩu mới: ${newPassword}\n\nThông tin đã được gửi cho admin. Vui lòng liên hệ với admin hoặc đăng nhập lại sau 1h sau khi admin cập nhật.`
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error("Lỗi gửi email quên mật khẩu:", error);
      return res.json({ success: false, message: "Gửi yêu cầu quên mật khẩu không thành công." });
    } else {
      return res.json({ success: true, message: "Thông tin đã được gửi cho admin. Vui lòng liên hệ với admin hoặc đăng nhập lại sau 1h." });
    }
  });
});

// Middleware kiểm tra đăng nhập
function isAuthenticated(req, res, next) {
  if (req.session && req.session.user) {
    next();
  } else {
    res.redirect('/login.html');
  }
}

// ------------------- Các API TÌM KIẾM - XUẤT EXCEL (GIỮ NGUYÊN) -------------------

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

// Tìm kiếm dữ liệu với phân trang
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

// Xuất dữ liệu sang file Excel
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

// Ví dụ route được bảo vệ (để mở rộng sau này)
app.get('/dashboard', isAuthenticated, (req, res) => {
  res.send(`Chào mừng ${req.session.user.name || req.session.user.email}, đây là trang dashboard.`);
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
