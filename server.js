const express = require('express');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const session = require('express-session');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');

const app = express();
const port = process.env.PORT || 3000;

// Cấu hình Multer để upload file vào bộ nhớ
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Middleware để parse JSON và dữ liệu form
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cấu hình session (in-memory store)
app.use(session({
  secret: 'your-secret-key', // Thay đổi thành chuỗi bí mật của bạn
  resave: false,
  saveUninitialized: false
}));

// Serve file tĩnh từ thư mục "public"
app.use(express.static(path.join(__dirname, 'public')));

// ----------------------- SUPABASE KHỞI TẠO -----------------------
// Các biến môi trường SUPABASE_URL và SUPABASE_KEY phải được cấu hình trên Vercel
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// ----------------------- PHẦN DỮ LIỆU -----------------------
// Dữ liệu tra cứu từ file data.json (nếu cần cho các API search/export)
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

// Dữ liệu người dùng từ file users.json
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
  if (req.session && req.session.user) return next();
  res.redirect('/login.html');
}

function isAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') return next();
  res.status(403).json({ success: false, message: "Chỉ admin mới có quyền thực hiện thao tác này." });
}

// ----------------------- API XÁC THỰC -----------------------
// Kiểm tra thông tin đăng nhập của user
app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.json({ success: false });
  res.json({ success: true, user: req.session.user });
});

// Đăng nhập
app.post('/login', (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) {
    return res.json({ success: false, message: "Vui lòng nhập đủ tên/email và mật khẩu." });
  }
  const user = usersData.find(u =>
    u.email.toLowerCase() === identifier.toLowerCase() ||
    u.name.toLowerCase() === identifier.toLowerCase()
  );
  if (!user) return res.json({ success: false, message: "Người dùng không tồn tại." });
  if (user.password !== password) return res.json({ success: false, message: "Sai mật khẩu." });
  req.session.user = { name: user.name, email: user.email, role: user.role };
  return res.json({ success: true, message: "Đăng nhập thành công." });
});

// Đăng xuất
app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) console.error("Lỗi xóa session:", err);
    res.redirect('/login.html');
  });
});

// ----------------------- TRANG -----------------------
// Trang Home
app.get('/home', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'home.html'));
});
app.get('/home.html', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'home.html'));
});

// Route cho trang Tasks (để hiển thị tasks.html)
app.get('/tasks', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'tasks.html'));
});

// ----------------------- API TRA CỨU & XUẤT (data.json) -----------------------
// (Giữ nguyên nếu cần)
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

// ----------------------- TASKS ENDPOINTS (Supabase) -----------------------
// GET tasks (đã được xử lý bởi route /tasks để gửi tasks.html cho giao diện)
app.get('/api/tasks', isAuthenticated, async (req, res) => {
  try {
    let { data, error } = await supabase
      .from('tasks')
      .select('*')
      .order('id', { ascending: true });
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error("Error in GET /api/tasks:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST new task (chỉ admin)
app.post('/api/tasks', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { title, assignedTo, priority, deadline, description, status, imageURL } = req.body;
    let { data, error } = await supabase
      .from('tasks')
      .insert([{ title, assignedTo, priority, deadline, description, status, imageURL }])
      .select();
    if (error) throw error;
    if (!data || data.length === 0) {
      return res.status(500).json({ success: false, message: "No data returned from Supabase" });
    }
    res.json({ success: true, task: data[0] });
  } catch (error) {
    console.error("Error in POST /api/tasks:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT update task (admin có thể cập nhật mọi trường; user chỉ cập nhật nếu được giao)
app.put('/api/tasks/:id', isAuthenticated, async (req, res) => {
  const taskId = req.params.id;
  try {
    let { data: taskData, error: selectError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .single();
    if (selectError) throw selectError;
    if (req.session.user.role !== 'admin' && taskData.assignedTo !== req.session.user.name) {
      return res.status(403).json({ success: false, message: "Bạn không có quyền cập nhật nhiệm vụ này." });
    }
    let updateData = { ...req.body };
    if (req.session.user.role !== 'admin') {
      delete updateData.assignedTo;
    }
    let { data, error: updateError } = await supabase
      .from('tasks')
      .update(updateData)
      .eq('id', taskId)
      .select();
    if (updateError) throw updateError;
    res.json({ success: true, task: data[0] });
  } catch (error) {
    console.error("Error in PUT /api/tasks/:id:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE task (chỉ admin)
app.delete('/api/tasks/:id', isAuthenticated, isAdmin, async (req, res) => {
  const taskId = req.params.id;
  try {
    let { data, error } = await supabase
      .from('tasks')
      .delete()
      .eq('id', taskId)
      .select();
    if (error) throw error;
    res.json({ success: true, message: "Nhiệm vụ đã được xóa thành công!" });
  } catch (error) {
    console.error("Error in DELETE /api/tasks/:id:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ----------------------- COMMENTS ENDPOINTS -----------------------
// GET comments cho nhiệm vụ
app.get('/api/tasks/:id/comments', isAuthenticated, async (req, res) => {
  const taskId = req.params.id;
  try {
    let { data, error } = await supabase
      .from('task_comments')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error("Error in GET /api/tasks/:id/comments:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST new comment cho nhiệm vụ
app.post('/api/tasks/:id/comments', isAuthenticated, async (req, res) => {
  const taskId = req.params.id;
  const { comment_text } = req.body;
  const userName = req.session.user.name || req.session.user.email;
  try {
    let { data, error } = await supabase
      .from('task_comments')
      .insert([{ task_id: taskId, "user": userName, comment_text }])
      .select();
    if (error) throw error;
    res.json({ success: true, comment: data[0] });
  } catch (error) {
    console.error("Error in POST /api/tasks/:id/comments:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ----------------------- IMAGE UPLOAD ENDPOINT -----------------------
app.post('/api/upload-image', isAuthenticated, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file provided' });
    const fileName = `task-images/${Date.now()}_${req.file.originalname}`;
    let { data, error } = await supabase
      .storage
      .from('tasks-images')
      .upload(fileName, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
    if (error) {
      console.error("Error uploading image:", error);
      return res.status(500).json({ success: false, message: error.message });
    }
    const { data: publicUrlData, error: publicUrlError } = supabase
      .storage
      .from('tasks-images')
      .getPublicUrl(data.path);
    if (publicUrlError) {
      console.error("Error getting public URL:", publicUrlError);
      return res.status(500).json({ success: false, message: publicUrlError.message });
    }
    res.json({ success: true, imageUrl: publicUrlData.publicUrl });
  } catch (error) {
    console.error("Error in POST /api/upload-image:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ----------------------- DASHBOARD ROUTE -----------------------
app.get('/dashboard', isAuthenticated, (req, res) => {
  res.send(`Chào mừng ${req.session.user.name || req.session.user.email}, đây là trang dashboard.`);
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
