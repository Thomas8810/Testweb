const express = require('express');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const cookieSession = require('cookie-session');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');

const app = express();
const port = process.env.PORT || 3000;

// Cấu hình cookie-session: lưu session trong cookie của client
app.use(cookieSession({
  name: 'session',
  keys: ['your-secret-key'], // Thay đổi chuỗi bí mật
  maxAge: 24 * 60 * 60 * 1000 // 1 ngày
}));

// Middleware parse JSON & form data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve file tĩnh từ thư mục "public"
app.use(express.static(path.join(__dirname, 'public')));

// ----------------------- SUPABASE KHỞI TẠO -----------------------
// Các biến môi trường SUPABASE_URL và SUPABASE_KEY phải được thiết lập
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// ----------------------- CẤU HÌNH UPLOAD FILE -----------------------
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// ----------------------- PHẦN DỮ LIỆU -----------------------
// Load dữ liệu từ data.json (nếu cần)
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
    console.log("Data loaded from data.json");
  } catch (err) {
    console.error("Error reading data.json:", err);
  }
}
loadDataFromFile();

// Load dữ liệu người dùng từ users.json
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
    console.log("Users data loaded");
  } catch (err) {
    console.error("Error reading users.json:", err);
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
  res.status(403).json({ success: false, message: "Admin privileges required" });
}

// ----------------------- API XÁC THỰC -----------------------
// Kiểm tra thông tin user
app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.json({ success: false });
  res.json({ success: true, user: req.session.user });
});

// Đăng nhập
app.post('/login', (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) {
    return res.json({ success: false, message: "Missing identifier or password" });
  }
  const user = usersData.find(u =>
    u.email.toLowerCase() === identifier.toLowerCase() ||
    u.name.toLowerCase() === identifier.toLowerCase()
  );
  if (!user) return res.json({ success: false, message: "User not found" });
  if (user.password !== password) return res.json({ success: false, message: "Incorrect password" });
  req.session.user = { name: user.name, email: user.email, role: user.role };
  res.json({ success: true, message: "Login successful" });
});

// Đăng xuất
app.get('/logout', (req, res) => {
  req.session = null;
  res.redirect('/login.html');
});

// ----------------------- TRANG -----------------------
// Home
app.get('/home', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'home.html'));
});
app.get('/home.html', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'home.html'));
});
// Tasks page
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
// GET /api/tasks
// Nếu user không phải admin, chỉ trả về nhiệm vụ của chính họ; nếu admin, có thể truyền query assignedTo.
app.get('/api/tasks', isAuthenticated, async (req, res) => {
  try {
    let query = supabase
      .from('tasks')
      .select('*')
      .order('id', { ascending: true });
    if (req.session.user.role !== 'admin') {
      query = query.eq('assignedTo', req.session.user.name);
    } else if (req.query.assignedTo) {
      query = query.eq('assignedTo', req.query.assignedTo);
    }
    let { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error("Error in GET /api/tasks:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/tasks - Tạo nhiệm vụ (chỉ admin)
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

// Hàm ghi log lịch sử thay đổi nhiệm vụ
async function logTaskHistory(taskId, changedBy, action, oldValue, newValue) {
  const { data, error } = await supabase
    .from('task_history')
    .insert([{ task_id: taskId, changed_by: changedBy, action, old_value: oldValue, new_value: newValue }])
    .select();
  if (error) console.error("Error logging task history:", error);
  return data;
}

// PUT /api/tasks/:id - Cập nhật nhiệm vụ (admin có thể cập nhật mọi trường; user chỉ cập nhật nếu được giao)
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
    // Ghi log thay đổi nếu có (ví dụ thay đổi trạng thái)
    const oldStatus = taskData.status;
    const newStatus = updateData.status;
    let { data, error: updateError } = await supabase
      .from('tasks')
      .update(updateData)
      .eq('id', taskId)
      .select();
    if (updateError) throw updateError;
    if (newStatus && newStatus !== oldStatus) {
      await logTaskHistory(taskId, req.session.user.name, 'Status change', oldStatus, newStatus);
    }
    res.json({ success: true, task: data[0] });
  } catch (error) {
    console.error("Error in PUT /api/tasks/:id:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/tasks/:id - Xóa nhiệm vụ (chỉ admin)
app.delete('/api/tasks/:id', isAuthenticated, isAdmin, async (req, res) => {
  const taskId = req.params.id;
  try {
    let { data, error } = await supabase
      .from('tasks')
      .delete()
      .eq('id', taskId)
      .select();
    if (error) throw error;
    res.json({ success: true, message: "Task deleted successfully!" });
  } catch (error) {
    console.error("Error in DELETE /api/tasks/:id:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ----------------------- ATTACHMENTS ENDPOINTS -----------------------
// POST /api/tasks/:id/attachments - Upload file đính kèm cho nhiệm vụ
app.post('/api/tasks/:id/attachments', isAuthenticated, upload.single('file'), async (req, res) => {
  const taskId = req.params.id;
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file provided' });
    }
    const fileName = `attachments/${Date.now()}_${req.file.originalname}`;
    let { data, error } = await supabase
      .storage
      .from('tasks-attachments')
      .upload(fileName, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
    if (error) throw error;
    const { data: publicUrlData, error: publicUrlError } = supabase
      .storage
      .from('tasks-attachments')
      .getPublicUrl(data.path);
    if (publicUrlError) throw publicUrlError;
    let { data: attachData, error: dbError } = await supabase
      .from('task_attachments')
      .insert([{
        task_id: taskId,
        file_name: req.file.originalname,
        file_url: publicUrlData.publicUrl,
        file_type: req.file.mimetype
      }])
      .select();
    if (dbError) throw dbError;
    res.json({ success: true, attachment: attachData[0] });
  } catch (error) {
    console.error("Error uploading attachment:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/tasks/:id/attachments - Lấy danh sách file đính kèm cho nhiệm vụ
app.get('/api/tasks/:id/attachments', isAuthenticated, async (req, res) => {
  const taskId = req.params.id;
  try {
    let { data, error } = await supabase
      .from('task_attachments')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error("Error fetching attachments:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ----------------------- COMMENTS ENDPOINTS -----------------------
// GET /api/tasks/:id/comments - Lấy comment cho nhiệm vụ
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

// POST /api/tasks/:id/comments - Tạo comment cho nhiệm vụ
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
// POST /api/upload-image - Upload ảnh cho nhiệm vụ
app.post('/api/upload-image', isAuthenticated, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file provided' });
    const fileName = `task-images/${Date.now()}_${req.file.originalname}`;
    let { data, error } = await supabase
      .storage
      .from('tasks-images')
      .upload(fileName, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
    if (error) throw error;
    const { data: publicUrlData, error: publicUrlError } = supabase
      .storage
      .from('tasks-images')
      .getPublicUrl(data.path);
    if (publicUrlError) throw publicUrlError;
    res.json({ success: true, imageUrl: publicUrlData.publicUrl });
  } catch (error) {
    console.error("Error in POST /api/upload-image:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ----------------------- PROGRESS ENDPOINT -----------------------
// GET /api/progress - Lấy tiến độ công việc của từng user
app.get('/api/progress', isAuthenticated, async (req, res) => {
  try {
    let { data, error } = await supabase
      .from('tasks')
      .select('assignedTo, status');
    if (error) throw error;
    let progress = {};
    data.forEach(task => {
      let user = task.assignedTo || "Không xác định";
      if (!progress[user]) {
        progress[user] = { name: user, total: 0, completed: 0 };
      }
      progress[user].total++;
      if (task.status === "Hoàn thành") progress[user].completed++;
    });
    res.json(Object.values(progress));
  } catch (err) {
    console.error("Error in GET /api/progress:", err);
    res.status(500).json({ success: false, message: "Error fetching progress data." });
  }
});

// ----------------------- DASHBOARD ROUTE -----------------------
app.get('/dashboard', isAuthenticated, (req, res) => {
  res.send(`Chào mừng ${req.session.user.name || req.session.user.email}, đây là trang dashboard.`);
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
