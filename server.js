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
  keys: ['your-secret-key'], // Thay đổi chuỗi bí mật của bạn
  maxAge: 24 * 60 * 60 * 1000 // 1 ngày
}));

// ----------------------- PARSE DATA -----------------------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ----------------------- STATIC FILES -----------------------
app.use(express.static(path.join(__dirname, 'public')));

// ----------------------- SUPABASE KHỞI TẠO -----------------------
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY; // Nên dùng Service Role key cho đầy đủ quyền
const supabase = createClient(supabaseUrl, supabaseKey);

// ----------------------- MULTER CONFIG -----------------------
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// ----------------------- DỮ LIỆU TRA CỨU & NGƯỜI DÙNG -----------------------
const dataFilePath = path.join(__dirname, 'data.json');
let cachedData = [];


let headerOrder = [];

function loadDataFromFile() {
  try {
    if (fs.existsSync(dataFilePath)) {
      const fileData = fs.readFileSync(dataFilePath, 'utf8');
      let raw = JSON.parse(fileData);

      // Tự động lấy cột
      const headerSet = new Set();
      raw.forEach(row => {
        Object.keys(row).forEach(key => headerSet.add(key));
      });
      headerOrder = Array.from(headerSet);

      cachedData = raw.map(row => {
        const normalized = {};
        headerOrder.forEach(key => {
          normalized[key] = row[key] || "";
        });
        return normalized;
      });

      console.log("✅ data.json loaded with dynamic headers:", headerOrder);
    } else {
      cachedData = [];
      headerOrder = [];
      console.log("⚠️ File data.json not found.");
    }
  } catch (err) {
    console.error("❌ Error reading data.json:", err);
    cachedData = [];
    headerOrder = [];
  }
}

loadDataFromFile();


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
app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.json({ success: false });
  res.json({ success: true, user: req.session.user });
});

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

app.get('/logout', (req, res) => {
  req.session = null;
  res.redirect('/login.html');
});

// ----------------------- ROUTES CHO TRANG -----------------------
app.get('/home', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'home.html'));
});
app.get('/home.html', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'home.html'));
});
app.get('/tasks', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'tasks.html'));
});
app.get('/voice_search', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'voice_search.html'));
});
app.get('/dashboard', isAuthenticated, (req, res) => {
  res.send(`Chào mừng ${req.session.user.name || req.session.user.email}, đây là trang dashboard.`);
});
// Phần này bổ sung cho voice
app.get('/data.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'data.json'));
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
    const { data: taskData, error: taskError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .single();
    if (taskError) throw taskError;

    if (taskData.image_path) {
      console.log("Deleting image:", taskData.image_path);
      const { error: removeImageError } = await supabase
        .storage
        .from('tasks-images')
        .remove([taskData.image_path]);
      if (removeImageError) {
        console.error("Error removing task image:", removeImageError);
      }
    }

    const { data: attachments, error: attError } = await supabase
      .from('task_attachments')
      .select('*')
      .eq('task_id', taskId);
    if (attError) throw attError;

    for (const att of attachments) {
      if (att.file_path) {
        console.log("Deleting attachment:", att.file_path);
        const { error: removeAttError } = await supabase
          .storage
          .from('tasks-attachments')
          .remove([att.file_path]);
        if (removeAttError) {
          console.error("Error removing attachment:", removeAttError);
        }
      }
    }

    const { error: deleteAttError } = await supabase
      .from('task_attachments')
      .delete()
      .eq('task_id', taskId);
    if (deleteAttError) throw deleteAttError;

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
    const filePath = uploadData.path;
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

// ----------------------- SEARCH & EXPORT ENDPOINTS -----------------------

// Hàm chuyển đổi số serial Excel sang đối tượng Date của JavaScript
function parseExcelDate(excelSerialDate) {
    if (typeof excelSerialDate !== 'number' || isNaN(excelSerialDate)) {
        return null;
    }

    // 25569 là số ngày từ 1899-12-31 đến 1970-01-01 (Unix epoch)
    // Excel có một "lỗi" là coi năm 1900 là năm nhuận, nên ngày 29/02/1900 tồn tại trong Excel.
    // Để khớp với JS (và các hệ thống chuẩn), cần điều chỉnh nếu ngày lớn hơn 28/02/1900.
    let adjustedSerialDate = excelSerialDate;
    if (excelSerialDate > 59) { // Ngày 59 là 28/02/1900 trong hệ thống Excel
        adjustedSerialDate = excelSerialDate - 1; // Bỏ qua ngày 29/02/1900 giả định
    }

    const date = new Date(0); // Bắt đầu từ Unix epoch (01/01/1970 UTC)
    date.setDate(adjustedSerialDate - 25569); // Cộng thêm số ngày đã điều chỉnh

    // Đảm bảo trả về ngày theo múi giờ địa phương mà không bị lệch giờ
    // Quan trọng: Sử dụng UTC để tránh vấn đề múi giờ khi so sánh ngày
    return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

// API lấy danh sách giá trị lọc
app.get('/filters', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const filePath = path.join(__dirname, 'data.json');

  let rawData;
  try {
    rawData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    console.error('Error reading data.json:', err);
    return res.status(500).json({ error: 'Failed to load data' });
  }

  const uniqueValues = {};

  rawData.forEach(row => {
    Object.entries(row).forEach(([key, val]) => {
      if (val !== null && val !== undefined && val !== "") {
        if (!uniqueValues[key]) uniqueValues[key] = new Set();
        uniqueValues[key].add(val.toString().trim());
      }
    });
  });

  const result = {};
  Object.entries(uniqueValues).forEach(([key, set]) => {
    result[key] = Array.from(set).sort((a, b) => a.localeCompare(b, 'vi'));
  });

  res.json(result);
});


// API tìm kiếm dữ liệu có phân trang
app.get('/search', (req, res) => {
  let filtered = cachedData;
  const { limit, offset, ...filters } = req.query;

  // Xử lý lọc theo ngày tháng trước
  let fromDate = null;
  let toDate = null;
  const dateColumnFilterKey = 'Submit date'; // Tên cột ngày trong data.json

  if (filters[`${dateColumnFilterKey}_from`]) {
    fromDate = new Date(filters[`${dateColumnFilterKey}_from`]);
    // Đảm bảo fromDate là đầu ngày (00:00:00) theo UTC để so sánh nhất quán
    fromDate = new Date(Date.UTC(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate()));
    delete filters[`${dateColumnFilterKey}_from`];
  }
  if (filters[`${dateColumnFilterKey}_to`]) {
    toDate = new Date(filters[`${dateColumnFilterKey}_to`]);
    // Đảm bảo toDate là cuối ngày (23:59:59) theo UTC để so sánh nhất quán
    toDate = new Date(Date.UTC(toDate.getFullYear(), toDate.getMonth(), toDate.getDate(), 23, 59, 59, 999));
    delete filters[`${dateColumnFilterKey}_to`];
  }

  // Áp dụng lọc theo ngày tháng
  if (fromDate || toDate) {
    filtered = filtered.filter(row => {
      const rowDateValue = row[dateColumnFilterKey];
      const rowDate = parseExcelDate(rowDateValue); // Chuyển đổi số Excel sang Date object

      if (!rowDate) return false; // Bỏ qua nếu ngày không hợp lệ

      const isAfterFrom = fromDate ? rowDate >= fromDate : true;
      const isBeforeTo = toDate ? rowDate <= toDate : true;

      return isAfterFrom && isBeforeTo;
    });
  }

  // Xử lý các bộ lọc khác
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

// API xuất dữ liệu sang file Excel
app.get('/export', (req, res) => {
  let filtered = cachedData;
  const { limit, offset, ...filters } = req.query; // Lấy tất cả filters trừ limit/offset

  // Xử lý lọc theo ngày tháng cho export
  let fromDate = null;
  let toDate = null;
  const dateColumnFilterKey = 'Submit date';

  if (filters[`${dateColumnFilterKey}_from`]) {
    fromDate = new Date(filters[`${dateColumnFilterKey}_from`]);
    fromDate = new Date(Date.UTC(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate()));
    delete filters[`${dateColumnFilterKey}_from`];
  }
  if (filters[`${dateColumnFilterKey}_to`]) {
    toDate = new Date(filters[`${dateColumnFilterKey}_to`]);
    toDate = new Date(Date.UTC(toDate.getFullYear(), toDate.getMonth(), toDate.getDate(), 23, 59, 59, 999));
    delete filters[`${dateColumnFilterKey}_to`];
  }

  if (fromDate || toDate) {
    filtered = filtered.filter(row => {
      const rowDateValue = row[dateColumnFilterKey];
      const rowDate = parseExcelDate(rowDateValue);

      if (!rowDate) return false;

      const isAfterFrom = fromDate ? rowDate >= fromDate : true;
      const isBeforeTo = toDate ? rowDate <= toDate : true;

      return isAfterFrom && isBeforeTo;
    });
  }

  // Xử lý các bộ lọc khác (ngoài ngày tháng)
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

  // Danh sách các cột ngày cần xử lý để định dạng lại cho Excel
  const dateColumns = ['PO received date', 'Customer need date', 'Submit date'];

  filtered = filtered.map(row => {
    const newRow = { ...row };
    dateColumns.forEach(col => {
      const val = newRow[col];
      if (typeof val === 'number') {
        const date = parseExcelDate(val);
        if (date && !isNaN(date.getTime())) {
          const year = date.getFullYear();
          const mm = String(date.getMonth() + 1).padStart(2, '0');
          const dd = String(date.getDate()).padStart(2, '0');
          newRow[col] = `${year}-${mm}-${dd}`;
        }
      } else if (typeof val === 'string') {
        // Nếu đã là chuỗi ngày tháng YYYY-MM-DD, giữ nguyên
        // Nếu là định dạng chuỗi khác, cố gắng parse và format
        const date = new Date(val);
        if (!isNaN(date.getTime())) {
            const year = date.getFullYear();
            const mm = String(date.getMonth() + 1).padStart(2, '0');
            const dd = String(date.getDate()).padStart(2, '0');
            newRow[col] = `${year}-${mm}-${dd}`;
        }
      }
    });
    return newRow;
  });


  const wb = XLSX.utils.book_new();

  const ws = XLSX.utils.json_to_sheet(filtered, { header: headerOrder });

  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Disposition', 'attachment; filename=export.xlsx');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.send(buf);
});
// Xóa một attachment (chỉ admin mới được xóa)
app.delete('/api/attachments/:id', isAuthenticated, isAdmin, async (req, res) => {
  const attachmentId = req.params.id;
  try {
    // 1) Tìm attachment trong bảng task_attachments
    const { data: attData, error: attError } = await supabase
      .from('task_attachments')
      .select('*')
      .eq('id', attachmentId)
      .single();
    if (attError) throw attError;
    if (!attData) {
      return res.json({ success: false, message: "Không tìm thấy attachment" });
    }

    // 2) Xóa file thực tế khỏi Supabase Storage (nếu có file_path)
    if (attData.file_path) {
      console.log("Deleting attachment file:", attData.file_path);
      const { error: storageError } = await supabase
        .storage
        .from('tasks-attachments')
        .remove([attData.file_path]);
      if (storageError) {
        // Không bắt buộc dừng, chỉ log lỗi
        console.error("Error removing file from storage:", storageError);
      }
    }

    // 3) Xóa dòng trong bảng task_attachments
    const { error: delError } = await supabase
      .from('task_attachments')
      .delete()
      .eq('id', attachmentId);
    if (delError) throw delError;

    // 4) Trả về kết quả
    return res.json({ success: true, message: "Attachment deleted successfully!" });
  } catch (error) {
    console.error("Error deleting attachment:", error);
    return res.json({ success: false, message: error.message });
  }
});

// ----------------------- START SERVER -----------------------
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
