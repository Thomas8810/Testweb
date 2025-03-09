const express = require('express');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const session = require('express-session');
const { createClient } = require('@supabase/supabase-js'); // Thư viện Supabase

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

// ----------------------- SUPABASE KHỞI TẠO -----------------------
// Lấy thông tin từ biến môi trường (đã cấu hình trên Vercel)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

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

app.get('/home', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'home.html'));
});

// Cũng cho phép truy cập qua đường dẫn /home.html nếu cần
app.get('/home.html', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'home.html'));
});

// ----------------------- CÁC API TRA CỨU & XUẤT EXCEL -----------------------

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
    "Description": getDistinct("Description"),
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
  const headerOrder = [
    "Part Number", "REV", "PO Number", "Project", "Description", "Note Number",
    "Critical", "CE", "Material", "Plating", "Painting", "Tiêu chuẩn mạ sơn",
    "Ngày Nhận PO", "Cover sheet", "Drawing", "Datasheet form", "Data",
    "COC", "BOM", "Mill", "Part Pictures", "Packaging Pictures", "Submit date",
    "Đã lên PO LAM", "OK", "Remark", "Remark 2", "Status", "Note"
  ];
  const ws = XLSX.utils.json_to_sheet(filtered, { header: headerOrder });

  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Disposition', 'attachment; filename=export.xlsx');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.send(buf);
});

// ----------------------- API TASKS SỬ DỤNG SUPABASE -----------------------

// Route phục vụ trang quản lý nhiệm vụ (tasks.html)
app.get('/tasks', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'tasks.html'));
});

// API lấy danh sách nhiệm vụ từ Supabase
app.get('/api/tasks', isAuthenticated, async (req, res) => {
  try {
    let { data, error } = await supabase
      .from('tasks')
      .select('*')
      .order('id', { ascending: true });
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// API tạo nhiệm vụ mới và lưu vào Supabase
app.post('/api/tasks', isAuthenticated, async (req, res) => {
  try {
    const { title, assignedTo, priority, deadline, description, status } = req.body;
    let { data, error } = await supabase
      .from('tasks')
      .insert([{ title, assignedTo, priority, deadline, description, status }]);
      .select(); // <--- BẮT BUỘC CÓ ĐỂ LẤY BẢN GHI VỪA THÊM
    if (error) throw error;
    res.json({ success: true, task: data[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ----------------------- ROUTE DASHBOARD -----------------------

app.get('/dashboard', isAuthenticated, (req, res) => {
  res.send(`Chào mừng ${req.session.user.name || req.session.user.email}, đây là trang dashboard.`);
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
