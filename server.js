const express = require('express');
const fs = require('fs'); // Vẫn giữ lại fs phòng trường hợp dùng cho việc khác, nhưng không dùng cho data.json và users.json nữa
const path = require('path');
const XLSX = require('xlsx');
const cookieSession = require('cookie-session');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');

const app = express();
const activeUsers = new Map(); // Map dạng { username => lastSeenTime }
const port = process.env.PORT || 3000;

// ----------------------- COOKIE-SESSION -----------------------
app.use(cookieSession({
  name: 'session',
  keys: ['your-very-secret-key-CHANGE-THIS-PLEASE'], // **QUAN TRỌNG:** Thay đổi chuỗi bí mật này!
  maxAge: 24 * 60 * 60 * 1000 // 24 hours
}));
// Theo dõi hoạt động người dùng
app.use((req, res, next) => {
  if (req.session && req.session.user) {
    activeUsers.set(req.session.user.name, Date.now());
  }
  next();
});

// API cho admin xem ai đang online
app.get('/api/active-users', isAdmin, (req, res) => {
  const now = Date.now();
  const threshold = 2 * 60 * 1000; // trong 2 phút
  const online = [];

  activeUsers.forEach((lastSeen, name) => {
    if (now - lastSeen < threshold) {
      online.push(name);
    }
  });

  res.json({ success: true, users: online });
});
// ----------------------- PARSE DATA -----------------------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ----------------------- STATIC FILES -----------------------
// Phục vụ các tệp tĩnh từ thư mục 'public' (ví dụ: background.jpg, css, js client-side nếu có)
app.use(express.static(path.join(__dirname, 'public')));

// ----------------------- SUPABASE KHỞI TẠO -----------------------
// Các biến này sẽ được lấy từ Environment Variables trên Vercel
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
let supabase;
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log("✅ Supabase client initialized.");
} else {
  console.warn("⚠️ SUPABASE_URL or SUPABASE_KEY is not set. Supabase features will be unavailable.");
  // Gán một đối tượng giả lập để code không bị crash nếu supabase được gọi mà chưa init
  supabase = {
    from: () => ({
      select: async () => ({ data: [], error: { message: "Supabase not configured" } }),
      insert: async () => ({ data: [], error: { message: "Supabase not configured" } }),
      update: async () => ({ data: [], error: { message: "Supabase not configured" } }),
      delete: async () => ({ data: [], error: { message: "Supabase not configured" } }),
      eq: () => {},
      order: () => {},
      single: async () => ({ data: null, error: { message: "Supabase not configured" } }),
    }),
    storage: {
        from: () => ({
            upload: async () => ({ data: null, error: { message: "Supabase not configured" } }),
            remove: async () => ({ data: null, error: { message: "Supabase not configured" } }),
            getPublicUrl: () => ({ data: { publicUrl: "" }, error: null })
        })
    }
  };
}


// ----------------------- MULTER CONFIG -----------------------
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// ----------------------- DỮ LIỆU TRA CỨU & NGƯỜI DÙNG -----------------------
let cachedData = [];
let headerOrder = [];

function loadDataFromFile() {
  try {
    cachedData = require('./data.json'); // Đảm bảo data.json ở thư mục gốc
    if (cachedData && cachedData.length > 0) {
      // Tự động lấy thứ tự cột từ item đầu tiên nếu có, hoặc từ tất cả các key nếu muốn an toàn hơn
      const headerSet = new Set();
      cachedData.forEach(row => {
        Object.keys(row).forEach(key => headerSet.add(key));
      });
      headerOrder = Array.from(headerSet);
    } else {
      cachedData = []; // Đảm bảo là mảng nếu file trống hoặc không đúng định dạng
      headerOrder = [];
    }
    console.log(`✅ data.json loaded via require. Found ${cachedData.length} records.`);
  } catch (err) {
    console.error("❌ Error requiring data.json:", err.message);
    cachedData = [];
    headerOrder = [];
  }
}
loadDataFromFile();


let usersData = [];
function loadUsersData() {
  try {
    usersData = require('./users.json'); // Đảm bảo users.json ở thư mục gốc
    console.log(`Users data loaded via require. Found ${usersData.length} users.`);
  } catch (err) {
    console.error("Error requiring users.json:", err.message);
    usersData = [];
  }
}
loadUsersData();

// ----------------------- MIDDLEWARE BẢO VỆ ROUTE -----------------------
function isAuthenticated(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  // Nếu không có session user, chuyển hướng về trang login
  return res.redirect('/login.html');
}

function isAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') {
    return next();
  }
  return res.status(403).json({ success: false, message: "Admin privileges required" });
}

// ----------------------- API ĐĂNG NHẬP & ĐĂNG XUẤT -----------------------
app.get('/api/me', (req, res) => {
  if (!req.session.user) {
    return res.json({ success: false });
  }
  res.json({ success: true, user: req.session.user });
});

app.post('/login', (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) {
    return res.json({ success: false, message: "Missing identifier or password" });
  }
  const user = usersData.find(u =>
    (u.email && u.email.toLowerCase() === identifier.toLowerCase()) ||
    (u.name && u.name.toLowerCase() === identifier.toLowerCase())
  );

  if (!user) {
    return res.json({ success: false, message: "User not found" });
  }

  if (user.password !== password) { // **LƯU Ý:** Trong thực tế, mật khẩu nên được hash và salt!
    return res.json({ success: false, message: "Incorrect password" });
  }

  req.session.user = { name: user.name, email: user.email, role: user.role };
  res.json({ success: true, message: "Login successful", user: req.session.user });
});

app.get('/logout', (req, res) => {
  req.session = null;
  res.redirect('/login.html'); // Hoặc trang chủ nếu public/index.html là trang chủ
});

// ----------------------- ROUTES CHO TRANG -----------------------
// Route cho trang login (public)
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Route mặc định, có thể là trang login hoặc trang chủ đã xác thực
app.get('/', isAuthenticated, (req, res) => {
  // Nếu bạn muốn trang chủ là home.html sau khi đăng nhập
  res.sendFile(path.join(__dirname, 'views', 'home.html'));
  // Hoặc nếu bạn có public/index.html là trang chào mừng/login khác
  // res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


app.get('/home', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'home.html'));
});
// Sửa lại để home.html cũng cần isAuthenticated nếu bạn muốn vậy
app.get('/home.html', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'home.html'));
});

app.get('/tasks', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'tasks.html'));
});
app.get('/tasks.html', isAuthenticated, (req, res) => { // Thêm route này nếu cần
  res.sendFile(path.join(__dirname, 'views', 'tasks.html'));
});

app.get('/voice_search', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'voice_search.html'));
});
app.get('/voice_search.html', isAuthenticated, (req, res) => { // Thêm route này nếu cần
  res.sendFile(path.join(__dirname, 'views', 'voice_search.html'));
});

// ----------------------- AUDIT LOG (Dùng Supabase) -----------------------
async function logTaskHistory(taskId, changedBy, action, oldValue, newValue) {
  if (!supabaseUrl || !supabaseKey) {
    console.warn("Supabase not configured, skipping task history log.");
    return;
  }
  try {
    const { data, error } = await supabase
      .from('task_history')
      .insert([{ task_id: taskId, changed_by: changedBy, action, old_value: oldValue, new_value: newValue }])
      .select();
    if (error) console.error("Error logging task history:", error);
    return data;
  } catch (e) {
    console.error("Exception logging task history:", e);
  }
}

// ----------------------- TASKS ENDPOINTS (Dùng Supabase) -----------------------
app.get('/api/tasks', isAuthenticated, async (req, res) => {
  if (!supabaseUrl || !supabaseKey) return res.status(503).json({ success: false, message: "Database service unavailable (Supabase not configured)" });
  try {
    let query = supabase.from('tasks').select('*').order('id', { ascending: true });
    if (req.session.user.role !== 'admin' && req.session.user.name) {
      query = query.eq('assignedTo', req.session.user.name);
    } else if (req.query.assignedTo && req.session.user.role === 'admin') {
      query = query.eq('assignedTo', req.query.assignedTo);
    }
    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error("Error in GET /api/tasks:", error);
    res.status(500).json({ success: false, message: error.message || JSON.stringify(error) });
  }
});

app.post('/api/tasks', isAuthenticated, isAdmin, async (req, res) => {
  if (!supabaseUrl || !supabaseKey) return res.status(503).json({ success: false, message: "Database service unavailable (Supabase not configured)" });
  try {
    const { title, assignedTo, priority, deadline, description, status = 'Chưa thực hiện', imageURL, image_path } = req.body;
    const { data, error } = await supabase
      .from('tasks')
      .insert([{ title, assignedTo, priority, deadline, description, status, imageURL, image_path, created_by: req.session.user.name }])
      .select();
    if (error) throw error;
    if (!data || data.length === 0) return res.status(500).json({ success: false, message: "No data returned from Supabase after insert" });
    
    await logTaskHistory(data[0].id, req.session.user.name, 'Task created', null, JSON.stringify(data[0]));
    res.json({ success: true, task: data[0] });
  } catch (error) {
    console.error("Error in POST /api/tasks:", error);
    res.status(500).json({ success: false, message: error.message || JSON.stringify(error) });
  }
});

app.put('/api/tasks/:id', isAuthenticated, async (req, res) => {
  if (!supabaseUrl || !supabaseKey) return res.status(503).json({ success: false, message: "Database service unavailable (Supabase not configured)" });
  const taskId = req.params.id;
  try {
    const { data: taskData, error: selectError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .single();
    if (selectError) throw selectError;
    if (!taskData) return res.status(404).json({ success: false, message: "Task not found." });

    if (req.session.user.role !== 'admin' && taskData.assignedTo !== req.session.user.name && taskData.created_by !== req.session.user.name) {
      return res.status(403).json({ success: false, message: "Bạn không có quyền cập nhật nhiệm vụ này." });
    }

    let updatePayload = { ...req.body };
    if (req.session.user.role !== 'admin') { // User thường không được tự ý đổi người nhận
      delete updatePayload.assignedTo;
    }
    
    const oldValues = JSON.stringify(taskData); // Log toàn bộ task cũ
    const { data: updated, error: updateError } = await supabase
      .from('tasks')
      .update(updatePayload)
      .eq('id', taskId)
      .select();
    if (updateError) throw updateError;

    await logTaskHistory(taskId, req.session.user.name, 'Task updated', oldValues, JSON.stringify(updated[0]));
    res.json({ success: true, task: updated[0] });
  } catch (error) {
    console.error(`Error in PUT /api/tasks/${taskId}:`, error);
    res.status(500).json({ success: false, message: error.message || JSON.stringify(error) });
  }
});

app.delete('/api/tasks/:id', isAuthenticated, isAdmin, async (req, res) => {
  if (!supabaseUrl || !supabaseKey) return res.status(503).json({ success: false, message: "Database service unavailable (Supabase not configured)" });
  const taskId = req.params.id;
  try {
    // Lấy thông tin task để log và xóa file đính kèm
    const { data: taskToDelete, error: fetchError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .single();
    if (fetchError || !taskToDelete) {
      console.error("Error fetching task for deletion or task not found:", fetchError);
      return res.status(404).json({ success: false, message: "Task not found or error fetching task." });
    }

    // Xóa các file đính kèm từ storage
    const { data: attachments, error: attError } = await supabase
      .from('task_attachments')
      .select('file_path')
      .eq('task_id', taskId);

    if (attError) console.error("Error fetching attachments for deletion:", attError);
    if (attachments && attachments.length > 0) {
      const filePathsToRemove = attachments.map(att => att.file_path).filter(Boolean);
      if (filePathsToRemove.length > 0) {
        const { error: storageError } = await supabase.storage.from('tasks-attachments').remove(filePathsToRemove);
        if (storageError) console.error("Error deleting files from Supabase Storage:", storageError);
      }
    }
    
    // Xóa các bản ghi task_attachments và task_comments liên quan
    await supabase.from('task_attachments').delete().eq('task_id', taskId);
    await supabase.from('task_comments').delete().eq('task_id', taskId);
    await supabase.from('task_history').delete().eq('task_id', taskId); // Xóa cả lịch sử task

    // Xóa task chính
    const { error } = await supabase.from('tasks').delete().eq('id', taskId);
    if (error) throw error;

    await logTaskHistory(taskId, req.session.user.name, 'Task deleted', JSON.stringify(taskToDelete), null);
    res.json({ success: true, message: "Task and associated data deleted successfully!" });
  } catch (error) {
    console.error("Error in DELETE /api/tasks/:id:", error);
    res.status(500).json({ success: false, message: error.message || JSON.stringify(error) });
  }
});

// ----------------------- COMMENTS ENDPOINTS (Dùng Supabase) -----------------------
app.get('/api/tasks/:taskId/comments', isAuthenticated, async (req, res) => {
  if (!supabaseUrl || !supabaseKey) return res.status(503).json({ success: false, message: "Database service unavailable (Supabase not configured)" });
  const { taskId } = req.params;
  try {
    const { data, error } = await supabase
      .from('task_comments')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error(`Error fetching comments for task ${taskId}:`, error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/tasks/:taskId/comments', isAuthenticated, async (req, res) => {
  if (!supabaseUrl || !supabaseKey) return res.status(503).json({ success: false, message: "Database service unavailable (Supabase not configured)" });
  const { taskId } = req.params;
  const { comment_text } = req.body;
  const userName = req.session.user.name || req.session.user.email;
  if (!comment_text || comment_text.trim() === "") {
    return res.status(400).json({ success: false, message: "Comment text cannot be empty." });
  }
  try {
    const { data, error } = await supabase
      .from('task_comments')
      .insert([{ task_id: taskId, user: userName, comment_text: comment_text.trim() }])
      .select();
    if (error) throw error;
    res.json({ success: true, comment: data[0] });
  } catch (error) {
    console.error(`Error posting comment for task ${taskId}:`, error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ----------------------- ATTACHMENTS ENDPOINT (Dùng Supabase) -----------------------
app.post('/api/tasks/:taskId/attachments', isAuthenticated, upload.single('file'), async (req, res) => {
  if (!supabaseUrl || !supabaseKey) return res.status(503).json({ success: false, message: "Database service unavailable (Supabase not configured)" });
  const { taskId } = req.params;
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file provided' });
    const filePathInBucket = `task_${taskId}/${Date.now()}_${req.file.originalname.replace(/\s+/g, '_')}`;
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('tasks-attachments') // Đảm bảo bucket name chính xác
      .upload(filePathInBucket, req.file.buffer, { contentType: req.file.mimetype, upsert: false });

    if (uploadError) throw uploadError;
    
    const { data: publicUrlData } = supabase.storage
      .from('tasks-attachments')
      .getPublicUrl(filePathInBucket);

    const { data: dbData, error: dbError } = await supabase
      .from('task_attachments')
      .insert([{
        task_id: taskId,
        file_name: req.file.originalname,
        file_url: publicUrlData.publicUrl,
        file_type: req.file.mimetype,
        file_path: filePathInBucket // Lưu path để có thể xóa file
      }])
      .select();
    if (dbError) throw dbError;
    res.json({ success: true, attachment: dbData[0] });
  } catch (error) {
    console.error("Error uploading attachment:", error);
    res.status(500).json({ success: false, message: error.message || JSON.stringify(error) });
  }
});

app.get('/api/tasks/:taskId/attachments', isAuthenticated, async (req, res) => {
  if (!supabaseUrl || !supabaseKey) return res.status(503).json({ success: false, message: "Database service unavailable (Supabase not configured)" });
  const { taskId } = req.params;
  try {
    const { data, error } = await supabase
      .from('task_attachments')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error(`Error fetching attachments for task ${taskId}:`, error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.delete('/api/attachments/:attachmentId', isAuthenticated, isAdmin, async (req, res) => {
  if (!supabaseUrl || !supabaseKey) return res.status(503).json({ success: false, message: "Database service unavailable (Supabase not configured)" });
  const { attachmentId } = req.params;
  try {
    const { data: attData, error: fetchAttError } = await supabase
      .from('task_attachments')
      .select('file_path')
      .eq('id', attachmentId)
      .single();
    if (fetchAttError || !attData) return res.status(404).json({ success: false, message: "Attachment not found." });

    if (attData.file_path) {
      const { error: storageError } = await supabase.storage.from('tasks-attachments').remove([attData.file_path]);
      if (storageError) console.error("Error removing file from storage:", storageError); // Log lỗi nhưng vẫn tiếp tục
    }
    const { error: dbError } = await supabase.from('task_attachments').delete().eq('id', attachmentId);
    if (dbError) throw dbError;
    res.json({ success: true, message: "Attachment deleted." });
  } catch (error) {
    console.error(`Error deleting attachment ${attachmentId}:`, error);
    res.status(500).json({ success: false, message: error.message });
  }
});


// ----------------------- API CHO `home.html` (dùng `cachedData`) -----------------------
app.get('/api/data', isAuthenticated, (req, res) => { // API này dùng cho voice_search.html
  res.json(cachedData);
});

app.get('/filters', isAuthenticated, (req, res) => {
  if (!cachedData || cachedData.length === 0) {
    return res.json({});
  }
  const distinctValues = {};
  const filterableColumns = ['Customer']; // Chỉ lấy Customer cho dropdown dự án ban đầu

  filterableColumns.forEach(column => {
    const values = new Set();
    cachedData.forEach(item => {
      if (item && item[column] !== undefined && item[column] !== null && item[column].toString().trim() !== '') {
        values.add(item[column].toString().trim());
      }
    });
    distinctValues[column] = Array.from(values).sort((a, b) => a.localeCompare(b, 'vi'));
  });
  res.json(distinctValues);
});

function convertYYYYMMDDToExcelSerial(yyyymmdd) {
    if (!yyyymmdd || !/^\d{4}-\d{2}-\d{2}$/.test(yyyymmdd)) return null;
    const [year, month, day] = yyyymmdd.split('-').map(Number);
    const dateObj = new Date(Date.UTC(year, month - 1, day));
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    return Math.floor((dateObj - excelEpoch) / (24 * 60 * 60 * 1000));
}

app.get('/search', isAuthenticated, (req, res) => {
  let results = [...cachedData];
  const params = req.query;
  const dateColumns = ['PO received date', 'Customer need date', 'Submit date'];

  for (const key in params) {
    if (key !== 'limit' && key !== 'offset' && params[key]) {
      const isDateRangeStart = key.endsWith('_start');
      const isDateRangeEnd = key.endsWith('_end');
      const baseKey = isDateRangeStart ? key.slice(0, -6) : (isDateRangeEnd ? key.slice(0, -4) : key);

      if (dateColumns.includes(baseKey)) {
        results = results.filter(item => {
          if (item[baseKey] === undefined || item[baseKey] === null || item[baseKey] === "") return false;
          const itemSerialDate = typeof item[baseKey] === 'number' ? item[baseKey] : convertYYYYMMDDToExcelSerial(item[baseKey].toString());
          if (itemSerialDate === null) return false; // Không thể chuyển đổi ngày của item

          const startDateParam = params[`${baseKey}_start`];
          const endDateParam = params[`${baseKey}_end`];

          const queryStartDateSerial = startDateParam ? convertYYYYMMDDToExcelSerial(startDateParam) : null;
          const queryEndDateSerial = endDateParam ? convertYYYYMMDDToExcelSerial(endDateParam) : null;
          
          let match = true;
          if (queryStartDateSerial !== null) {
            match = match && (itemSerialDate >= queryStartDateSerial);
          }
          if (queryEndDateSerial !== null) {
            match = match && (itemSerialDate <= queryEndDateSerial);
          }
          return match;
        });
      } else if (!key.endsWith('_start') && !key.endsWith('_end')) {
        let queryValues = params[key].split(',');
        results = results.filter(item => {
          if (item[key] === undefined || item[key] === null) return false;
          const itemStr = item[key].toString().toLowerCase();
          return queryValues.some(qVal => itemStr.includes(qVal.toLowerCase()));
        });
      }
    }
  }

  const total = results.length;
  const limit = parseInt(params.limit) || 50;
  const offset = parseInt(params.offset) || 0;
  const paginatedData = results.slice(offset, offset + limit);
  res.json({ data: paginatedData, total: total });
});

app.get('/export', isAuthenticated, (req, res) => {
  let results = [...cachedData];
  const params = req.query;
  const dateColumns = ['PO received date', 'Customer need date', 'Submit date'];

  for (const key in params) {
    if (params[key]) { 
      const isDateRangeStart = key.endsWith('_start');
      const isDateRangeEnd = key.endsWith('_end');
      const baseKey = isDateRangeStart ? key.slice(0, -6) : (isDateRangeEnd ? key.slice(0, -4) : key);

      if (dateColumns.includes(baseKey)) {
        results = results.filter(item => {
          if (item[baseKey] === undefined || item[baseKey] === null || item[baseKey] === "") return false;
          const itemSerialDate = typeof item[baseKey] === 'number' ? item[baseKey] : convertYYYYMMDDToExcelSerial(item[baseKey].toString());
           if (itemSerialDate === null) return false;

          const startDateParam = params[`${baseKey}_start`];
          const endDateParam = params[`${baseKey}_end`];
          const queryStartDateSerial = startDateParam ? convertYYYYMMDDToExcelSerial(startDateParam) : null;
          const queryEndDateSerial = endDateParam ? convertYYYYMMDDToExcelSerial(endDateParam) : null;
          
          let match = true;
          if (queryStartDateSerial !== null) match = match && (itemSerialDate >= queryStartDateSerial);
          if (queryEndDateSerial !== null) match = match && (itemSerialDate <= queryEndDateSerial);
          return match;
        });
      } else if (!key.endsWith('_start') && !key.endsWith('_end')) {
        let queryValues = params[key].split(',');
        results = results.filter(item => {
          if (item[key] === undefined || item[key] === null) return false;
          const itemStr = item[key].toString().toLowerCase();
          return queryValues.some(qVal => itemStr.includes(qVal.toLowerCase()));
        });
      }
    }
  }
  
  function formatExcelDateForOutput(serialOrStringDate) {
    if (typeof serialOrStringDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(serialOrStringDate)) {
        return serialOrStringDate; // Already in YYYY-MM-DD
    }
    if (typeof serialOrStringDate !== 'number' || isNaN(serialOrStringDate)) {
        return serialOrStringDate; 
    }
    const date = XLSX.SSF.parse_date_code(serialOrStringDate);
    if (date) {
        return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
    }
    return serialOrStringDate; 
  }

  const formattedResults = results.map(row => {
      const newRow = { ...row };
      dateColumns.forEach(colName => {
          if (newRow[colName] !== undefined && newRow[colName] !== null && newRow[colName] !== "") {
              newRow[colName] = formatExcelDateForOutput(newRow[colName]);
          } else {
              newRow[colName] = ""; // Để trống nếu không có giá trị
          }
      });
      return newRow;
  });

  const worksheet = XLSX.utils.json_to_sheet(formattedResults, { header: headerOrder });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Results");
  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });

  res.setHeader('Content-Disposition', 'attachment; filename="exported_data.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(excelBuffer);
});

// ----------------------- START SERVER -----------------------
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
  if (!supabaseUrl || !supabaseKey) {
    console.warn("*****************************************************************");
    console.warn("WARNING: Supabase URL or Key not configured in environment variables.");
    console.warn("Supabase-dependent features (like Tasks page) will not work correctly.");
    console.warn("Please set SUPABASE_URL and SUPABASE_KEY in your Vercel project settings.");
    console.warn("*****************************************************************");
  }
});

// Export the Express API
module.exports = app;
