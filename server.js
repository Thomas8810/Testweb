const express = require('express');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const cookieSession = require('cookie-session');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');

const app = express();
const port = process.env.PORT || 3000;

// ----------------------- COOKIE-SESSION -----------------------\napp.use(cookieSession({\n  name: 'session',\n  keys: ['your-secret-key'], // Thay đổi chuỗi bí mật của bạn\n  maxAge: 24 * 60 * 60 * 1000 // 1 ngày\n}));

// ----------------------- PARSE DATA -----------------------\napp.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ----------------------- STATIC FILES -----------------------\napp.use(express.static(path.join(__dirname, 'public')));

// ----------------------- SUPABASE KHỞI TẠO -----------------------\n// const supabaseUrl = process.env.SUPABASE_URL; // Bạn có thể dùng biến môi trường
// const supabaseKey = process.env.SUPABASE_KEY; // Hoặc hardcode nếu chỉ dùng local
const supabaseUrl = 'YOUR_SUPABASE_URL'; // THAY THẾ BẰNG URL SUPABASE CỦA BẠN
const supabaseKey = 'YOUR_SUPABASE_ANON_KEY'; // THAY THẾ BẰNG ANON KEY SUPABASE CỦA BẠN
const supabase = createClient(supabaseUrl, supabaseKey);


// ----------------------- MULTER CONFIG -----------------------\nconst storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// ----------------------- DỮ LIỆU TRA CỨU & NGƯỜI DÙNG -----------------------\nconst dataFilePath = path.join(__dirname, 'data.json');
let cachedData = [];
let headerOrder = []; // Sẽ được điền khi load dữ liệu lần đầu

// Hàm load dữ liệu từ file JSON
function loadDataFromFile() {
  try {
    const fileContent = fs.readFileSync(dataFilePath, 'utf8');
    cachedData = JSON.parse(fileContent);
    if (cachedData.length > 0) {
        headerOrder = Object.keys(cachedData[0]); // Lấy thứ tự cột từ item đầu tiên
    }
    console.log('Dữ liệu đã được tải và cache.');
  } catch (error) {
    console.error('Không thể đọc hoặc parse data.json:', error);
    cachedData = []; // Đảm bảo cachedData là một mảng trống nếu có lỗi
  }
}

// Load dữ liệu khi server khởi động
loadDataFromFile();

// Hàm chuyển đổi ngày YYYY-MM-DD sang số serial Excel
function convertYYYYMMDDToExcelSerial(yyyymmdd) {
    if (!yyyymmdd || !/^\d{4}-\d{2}-\d{2}$/.test(yyyymmdd)) {
        return null; // Trả về null nếu định dạng không hợp lệ
    }
    const [year, month, day] = yyyymmdd.split('-').map(Number);
    // Ngày gốc của Excel là 30/12/1899 (ngày 0), nhưng JavaScript tính từ 01/01/1970.
    // Chênh lệch giữa 01/01/1970 và 01/01/1900 là 25569 ngày.
    // (Excel coi 1900 là năm nhuận, nên ngày 0 của Excel thực sự là 1899-12-30)
    const dateObj = new Date(Date.UTC(year, month - 1, day)); // month is 0-indexed in JS
    const excelEpoch = new Date(Date.UTC(1899, 11, 30)); // Excel's day 0
    return Math.floor((dateObj - excelEpoch) / (24 * 60 * 60 * 1000));
}

// API endpoint để tìm kiếm
app.get('/search', (req, res) => {
  let results = [...cachedData]; // Tạo bản sao để không thay đổi dữ liệu gốc
  const params = req.query;
  const dateColumns = ['PO received date', 'Customer need date', 'Submit date']; // Các cột chứa ngày

  // Lọc dựa trên các tham số truy vấn
  for (const key in params) {
    if (key !== 'limit' && key !== 'offset' && params[key]) {
      let queryValues = params[key].split(','); // Cho phép nhiều giá trị được phân tách bằng dấu phẩy

      results = results.filter(item => {
        if (item[key] === undefined || item[key] === null) {
          return false;
        }
        let itemValue = item[key];

        if (dateColumns.includes(key)) {
          // Xử lý cho cột ngày: itemValue là số serial Excel
          // queryValues chứa các chuỗi ngày 'YYYY-MM-DD'
          return queryValues.some(qVal => {
            const querySerialDate = convertYYYYMMDDToExcelSerial(qVal);
            return querySerialDate !== null && itemValue === querySerialDate;
          });
        } else {
          // Xử lý cho các cột khác (so sánh chuỗi không phân biệt chữ hoa/thường)
          const itemStr = itemValue.toString().toLowerCase();
          return queryValues.some(qVal => itemStr.includes(qVal.toLowerCase()));
        }
      });
    }
  }

  const total = results.length;
  const limit = parseInt(params.limit) || 50;
  const offset = parseInt(params.offset) || 0;
  results = results.slice(offset, offset + limit);

  res.json({ data: results, total: total });
});


// API endpoint để lấy các giá trị filter động
app.get('/filters', (req, res) => {
  if (!cachedData || cachedData.length === 0) {
    return res.json({});
  }
  const distinctValues = {};
  // Chỉ lấy các giá trị cho cột 'Customer' như yêu cầu ban đầu của bạn
  const filterableColumns = ['Customer']; 

  filterableColumns.forEach(column => {
    const values = new Set();
    cachedData.forEach(item => {
      if (item[column] !== undefined && item[column] !== null && item[column].toString().trim() !== '') {
        values.add(item[column].toString().trim());
      }
    });
    distinctValues[column] = Array.from(values).sort();
  });
  res.json(distinctValues);
});


// API endpoint để xuất Excel
app.get('/export', (req, res) => {
  let results = [...cachedData];
  const params = req.query;
  const dateColumns = ['PO received date', 'Customer need date', 'Submit date'];

  for (const key in params) {
    if (params[key]) { // Chỉ lọc nếu có giá trị
      let queryValues = params[key].split(',');
      results = results.filter(item => {
        if (item[key] === undefined || item[key] === null) return false;
        let itemValue = item[key];

        if (dateColumns.includes(key)) {
          return queryValues.some(qVal => {
            const querySerialDate = convertYYYYMMDDToExcelSerial(qVal);
            return querySerialDate !== null && itemValue === querySerialDate;
          });
        } else {
          const itemStr = itemValue.toString().toLowerCase();
          return queryValues.some(qVal => itemStr.includes(qVal.toLowerCase()));
        }
      });
    }
  }
  
  // Hàm chuyển đổi số serial Excel sang định dạng ngày YYYY-MM-DD cho file Excel xuất ra
  function formatExcelDateForOutput(serial) {
      if (typeof serial !== 'number' || isNaN(serial)) return serial; // Trả về giá trị gốc nếu không phải số
      const date = XLSX.SSF.parse_date_code(serial);
      if (date) {
          return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
      }
      return serial; // Trả về serial nếu không parse được
  }

  // Định dạng lại các cột ngày trước khi xuất Excel
  const formattedResults = results.map(row => {
      const newRow = { ...row };
      dateColumns.forEach(colName => {
          if (newRow[colName] !== undefined && newRow[colName] !== null) {
              newRow[colName] = formatExcelDateForOutput(newRow[colName]);
          }
      });
      return newRow;
  });


  const worksheet = XLSX.utils.json_to_sheet(formattedResults, { header: headerOrder });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Results");

  // Ghi file Excel vào buffer
  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });

  res.setHeader('Content-Disposition', 'attachment; filename="exported_data.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(excelBuffer);
});


// Route cho trang chủ
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'home.html'));
});

// Route cho trang tasks
app.get('/tasks', (req, res) => {
    res.sendFile(path.join(__dirname, 'tasks.html'));
});

// Route cho trang voice search
app.get('/voice_search', (req, res) => {
    res.sendFile(path.join(__dirname, 'voice_search.html'));
});


// API endpoint để lấy tất cả task từ Supabase
app.get('/api/tasks', async (req, res) => {
    try {
        const { data, error } = await supabase.from('tasks').select('*');
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API endpoint để thêm task mới vào Supabase
app.post('/api/tasks', async (req, res) => {
    try {
        const { task_name, description, due_date, priority, status, assigned_to, project_id } = req.body;
        const { data, error } = await supabase
            .from('tasks')
            .insert([{ task_name, description, due_date, priority, status, assigned_to, project_id }])
            .select(); // Thêm select() để trả về bản ghi đã tạo

        if (error) throw error;
        res.status(201).json(data[0]); // Trả về task mới được tạo
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API endpoint để cập nhật task trong Supabase
app.put('/api/tasks/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body; // { task_name, description, ... }

        const { data, error } = await supabase
            .from('tasks')
            .update(updates)
            .eq('id', id)
            .select(); // Thêm select() để trả về bản ghi đã cập nhật

        if (error) throw error;
        if (data && data.length > 0) {
            res.json(data[0]);
        } else {
            res.status(404).json({ message: 'Task not found' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// API endpoint để xóa task khỏi Supabase
app.delete('/api/tasks/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { data, error } = await supabase.from('tasks').delete().eq('id', id);
        if (error) throw error;
        res.status(204).send(); // No content
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API để lấy danh sách người dùng (ví dụ)
app.get('/api/users', async (req, res) => {
    try {
        // Giả sử bạn có bảng 'profiles' hoặc 'users' trong Supabase
        const { data, error } = await supabase.from('profiles').select('id, username'); // Lấy id và username
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API để lấy danh sách dự án (ví dụ)
app.get('/api/projects', async (req, res) => {
    try {
        const { data, error } = await supabase.from('projects').select('id, project_name');
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API để tải lên file đính kèm cho task
app.post('/api/tasks/:taskId/attachments', upload.single('attachmentFile'), async (req, res) => {
    const { taskId } = req.params;
    const file = req.file;

    if (!file) {
        return res.status(400).json({ message: 'No file uploaded.' });
    }

    try {
        const filePath = `task_${taskId}/${Date.now()}_${file.originalname}`;
        const { data: uploadData, error: uploadError } = await supabase.storage
            .from('tasks-attachments') // Tên bucket của bạn
            .upload(filePath, file.buffer, {
                contentType: file.mimetype,
                upsert: false,
            });

        if (uploadError) throw uploadError;

        // Lấy URL công khai của file vừa tải lên
        const { data: publicUrlData } = supabase.storage
            .from('tasks-attachments')
            .getPublicUrl(filePath);

        // Lưu thông tin file vào bảng task_attachments
        const { data: dbData, error: dbError } = await supabase
            .from('task_attachments')
            .insert({
                task_id: taskId,
                file_name: file.originalname,
                file_path: filePath, // Lưu path để có thể xóa file sau này
                file_url: publicUrlData.publicUrl,
                file_type: file.mimetype,
                uploaded_at: new Date()
            })
            .select();

        if (dbError) throw dbError;

        res.status(201).json(dbData[0]);
    } catch (error) {
        console.error('Error uploading attachment:', error);
        res.status(500).json({ message: 'Error uploading file.', error: error.message });
    }
});

// API để lấy danh sách file đính kèm của một task
app.get('/api/tasks/:taskId/attachments', async (req, res) => {
    const { taskId } = req.params;
    try {
        const { data, error } = await supabase
            .from('task_attachments')
            .select('*')
            .eq('task_id', taskId);
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API để xóa file đính kèm
app.delete('/api/attachments/:id', async (req, res) => {
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
        .from('tasks-attachments') // Đảm bảo đúng tên bucket
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
    return res.json({ success: false, message: error.message || "Failed to delete attachment" });
  }
});


app.listen(port, () => {
  console.log(`Server đang chạy tại http://localhost:${port}`);
});
