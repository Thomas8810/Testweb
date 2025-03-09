const express = require('express');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const cookieSession = require('cookie-session');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');

const app = express();
const port = process.env.PORT || 3000;

// ----------------------- COOKIE-SESSION -----------------------
app.use(cookieSession({
  name: 'session',
  keys: ['your-secret-key'], // Thay đổi chuỗi bí mật
  maxAge: 24 * 60 * 60 * 1000 // 1 ngày
}));

// ----------------------- PARSE DATA -----------------------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ----------------------- STATIC FILES -----------------------
app.use(express.static(path.join(__dirname, 'public')));

// ----------------------- SUPABASE KHỞI TẠO -----------------------
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// ----------------------- MULTER CONFIG -----------------------
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// ----------------------- TẢI DỮ LIỆU (nếu cần) -----------------------
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

// ----------------------- TẢI USERS -----------------------
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
  return res.redirect('/login.html');
}
function isAdmin(req, res, next) {
  if (req.session?.user?.role === 'admin') return next();
  return res.status(403).json({ success: false, message: "Admin privileges required" });
}

// ----------------------- API ĐĂNG NHẬP & ĐĂNG XUẤT -----------------------
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

// ----------------------- ROUTES CHO TRANG -----------------------
// Trang Home
app.get('/home', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'home.html'));
});
app.get('/home.html', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'home.html'));
});
// Trang Tasks
app.get('/tasks', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'tasks.html'));
});
// Trang Dashboard (nếu có)
app.get('/dashboard', isAuthenticated, (req, res) => {
  res.send(`Chào mừng ${req.session.user.name || req.session.user.email}, đây là trang dashboard.`);
});

// ----------------------- AUDIT LOG -----------------------
async function logTaskHistory(taskId, changedBy, action, oldValue, newValue) {
  const { data, error } = await supabase
    .from('task_history')
    .insert([{ task_id: taskId, changed_by: changedBy, action, old_value: oldValue, new_value: newValue }])
    .select();
  if (error) console.error("Error logging task history:", error);
  return data;
}

// ----------------------- TASKS ENDPOINTS -----------------------
// Lấy danh sách nhiệm vụ
app.get('/api/tasks', isAuthenticated, async (req, res) => {
  try {
    let query = supabase.from('tasks').select('*').order('id', { ascending: true });
    if (req.session.user.role !== 'admin') {
      query = query.eq('assignedTo', req.session.user.name);
    } else if (req.query.assignedTo) {
      query = query.eq('assignedTo', req.query.assignedTo);
    }
    const { data, error } = await query;
    if (error) {
      console.error("Error in GET /api/tasks:", error);
      return res.status(500).json({ success: false, message: error.message || JSON.stringify(error) });
    }
    res.json(data);
  } catch (error) {
    console.error("Error in GET /api/tasks:", error);
    res.status(500).json({ success: false, message: error.message || JSON.stringify(error) });
  }
});

// Tạo nhiệm vụ (chỉ admin)
app.post('/api/tasks', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { title, assignedTo, priority, deadline, description, status, imageURL, image_path } = req.body;
    const { data, error } = await supabase
      .from('tasks')
      .insert([{ title, assignedTo, priority, deadline, description, status, imageURL, image_path }])
      .select();
    if (error) {
      console.error("Error in POST /api/tasks:", error);
      return res.status(500).json({ success: false, message: error.message || JSON.stringify(error) });
    }
    if (!data || data.length === 0) {
      return res.status(500).json({ success: false, message: "No data returned from Supabase" });
    }
    res.json({ success: true, task: data[0] });
  } catch (error) {
    console.error("Error in POST /api/tasks:", error);
    res.status(500).json({ success: false, message: error.message || JSON.stringify(error) });
  }
});

// Cập nhật nhiệm vụ
app.put('/api/tasks/:id', isAuthenticated, async (req, res) => {
  const taskId = req.params.id;
  try {
    const { data: taskData, error: selectError } = await supabase
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
    const oldStatus = taskData.status;
    const newStatus = updateData.status;
    const { data: updated, error: updateError } = await supabase
      .from('tasks')
      .update(updateData)
      .eq('id', taskId)
      .select();
    if (updateError) throw updateError;
    if (newStatus && newStatus !== oldStatus) {
      await logTaskHistory(taskId, req.session.user.name, 'Status change', oldStatus, newStatus);
    }
    res.json({ success: true, task: updated[0] });
  } catch (error) {
    console.error("Error in PUT /api/tasks/:id:", error);
    res.status(500).json({ success: false, message: error.message || JSON.stringify(error) });
  }
});

// Xóa nhiệm vụ (chỉ admin) và xóa file khỏi storage
app.delete('/api/tasks/:id', isAuthenticated, isAdmin, async (req, res) => {
  const taskId = req.params.id;
  try {
    // Lấy thông tin nhiệm vụ
    const { data: taskData, error: taskError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .single();
    if (taskError) throw taskError;
    
    // Nếu có ảnh nhiệm vụ, xóa file từ bucket 'tasks-images'
    if (taskData.image_path) {
      const { error: removeImageError } = await supabase
        .storage
        .from('task-images')
        .remove([taskData.image_path]);
      if (removeImageError) console.error("Error removing task image:", removeImageError);
    }
    
    // Lấy danh sách file đính kèm và xóa chúng
    const { data: attachments, error: attError } = await supabase
      .from('task_attachments')
      .select('*')
      .eq('task_id', taskId);
    if (attError) throw attError;
    for (const att of attachments) {
      if (att.file_path) {
        const { error: removeAttError } = await supabase
          .storage
          .from('tasks-attachments')
          .remove([att.file_path]);
        if (removeAttError) console.error("Error removing attachment:", removeAttError);
      }
    }
    
    // Xóa record trong bảng task_attachments (nếu chưa cascade)
    const { error: deleteAttError } = await supabase
      .from('task_attachments')
      .delete()
      .eq('task_id', taskId);
    if (deleteAttError) throw deleteAttError;
    
    // Xóa nhiệm vụ
    const { data, error } = await supabase
      .from('tasks')
      .delete()
      .eq('id', taskId)
      .select();
    if (error) throw error;
    res.json({ success: true, message: "Task deleted successfully!" });
  } catch (error) {
    console.error("Error in DELETE /api/tasks/:id:", error);
    res.status(500).json({ success: false, message: error.message || JSON.stringify(error) });
  }
});

// ----------------------- COMMENTS ENDPOINTS -----------------------
app.get('/api/tasks/:id/comments', isAuthenticated, async (req, res) => {
  const taskId = req.params.id;
  try {
    const { data, error } = await supabase
      .from('task_comments')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error("Error in GET /api/tasks/:id/comments:", error);
    res.status(500).json({ success: false, message: error.message || JSON.stringify(error) });
  }
});
app.post('/api/tasks/:id/comments', isAuthenticated, async (req, res) => {
  const taskId = req.params.id;
  const { comment_text } = req.body;
  const userName = req.session.user.name || req.session.user.email;
  try {
    const { data, error } = await supabase
      .from('task_comments')
      .insert([{ task_id: taskId, user: userName, comment_text }])
      .select();
    if (error) throw error;
    res.json({ success: true, comment: data[0] });
  } catch (error) {
    console.error("Error in POST /api/tasks/:id/comments:", error);
    res.status(500).json({ success: false, message: error.message || JSON.stringify(error) });
  }
});

// ----------------------- IMAGE UPLOAD ENDPOINT -----------------------
app.post('/api/upload-image', isAuthenticated, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file provided' });
    const fileName = `task-images/${Date.now()}_${req.file.originalname}`;
    const { data: uploadData, error: uploadError } = await supabase
      .storage
      .from('tasks-images')
      .upload(fileName, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
    if (uploadError) {
      console.error("Upload error:", JSON.stringify(uploadError, null, 2));
      return res.status(500).json({ success: false, message: uploadError.message || JSON.stringify(uploadError) });
    }
    const filePath = uploadData.path || uploadData.Key;
    const { data: publicUrlData, error: publicUrlError } = supabase
      .storage
      .from('tasks-images')
      .getPublicUrl(filePath);
    if (publicUrlError) {
      console.error("Error getting public URL:", publicUrlError);
      return res.status(500).json({ success: false, message: publicUrlError.message || JSON.stringify(publicUrlError) });
    }
    res.json({ success: true, imageUrl: publicUrlData.publicUrl, filePath });
  } catch (error) {
    console.error("Error in POST /api/upload-image:", error);
    res.status(500).json({ success: false, message: error.message || JSON.stringify(error) });
  }
});

// ----------------------- ATTACHMENTS ENDPOINT -----------------------
app.post('/api/tasks/:id/attachments', isAuthenticated, upload.single('file'), async (req, res) => {
  const taskId = req.params.id;
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file provided' });
    const fileName = `attachments/${Date.now()}_${req.file.originalname}`;
    const { data: uploadData, error: uploadError } = await supabase
      .storage
      .from('tasks-attachments')
      .upload(fileName, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
    if (uploadError) {
      console.error("Upload error:", JSON.stringify(uploadError, null, 2));
      return res.status(500).json({ success: false, message: uploadError.message || JSON.stringify(uploadError) });
    }
    const filePath = uploadData.path || uploadData.Key;
    const { data: publicUrlData, error: publicUrlError } = supabase
      .storage
      .from('tasks-attachments')
      .getPublicUrl(filePath);
    if (publicUrlError) {
      console.error("Error getting public URL:", publicUrlError);
      return res.status(500).json({ success: false, message: publicUrlError.message || JSON.stringify(publicUrlError) });
    }
    const { data: attachData, error: dbError } = await supabase
      .from('task_attachments')
      .insert([{
        task_id: taskId,
        file_name: req.file.originalname,
        file_url: publicUrlData.publicUrl,
        file_type: req.file.mimetype,
        file_path: filePath
      }])
      .select();
    if (dbError) {
      console.error("Error inserting attachment to DB:", JSON.stringify(dbError, null, 2));
      return res.status(500).json({ success: false, message: dbError.message || JSON.stringify(dbError) });
    }
    res.json({ success: true, attachment: attachData[0] });
  } catch (error) {
    console.error("Error uploading attachment:", error);
    res.status(500).json({ success: false, message: error.message || JSON.stringify(error) });
  }
});
app.get('/api/tasks/:id/attachments', isAuthenticated, async (req, res) => {
  const taskId = req.params.id;
  try {
    const { data, error } = await supabase
      .from('task_attachments')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error("Error fetching attachments:", error);
    res.status(500).json({ success: false, message: error.message || JSON.stringify(error) });
  }
});

// ----------------------- PROGRESS ENDPOINT -----------------------
app.get('/api/progress', isAuthenticated, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('tasks')
      .select('assignedTo, status');
    if (error) throw error;
    let progress = {};
    data.forEach(task => {
      const user = task.assignedTo || "Không xác định";
      if (!progress[user]) progress[user] = { name: user, total: 0, completed: 0 };
      progress[user].total++;
      if (task.status === "Hoàn thành") progress[user].completed++;
    });
    res.json(Object.values(progress));
  } catch (err) {
    console.error("Error in GET /api/progress:", err);
    res.status(500).json({ success: false, message: err.message || JSON.stringify(err) });
  }
});

// ----------------------- DASHBOARD ROUTE -----------------------
app.get('/dashboard', isAuthenticated, (req, res) => {
  res.send(`Chào mừng ${req.session.user.name || req.session.user.email}, đây là trang dashboard.`);
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
