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
  keys: ['your-secret-key-CHANGE-THIS'], // Thay đổi chuỗi bí mật của bạn
  maxAge: 24 * 60 * 60 * 1000 // 1 ngày
}));

// ----------------------- PARSE DATA -----------------------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ----------------------- STATIC FILES -----------------------
app.use(express.static(path.join(__dirname, 'public')));

// ----------------------- SUPABASE KHỞI TẠO -----------------------
// const supabaseUrl = process.env.SUPABASE_URL;
// const supabaseKey = process.env.SUPABASE_KEY;
const supabaseUrl = 'YOUR_SUPABASE_URL'; // THAY THẾ BẰNG URL SUPABASE CỦA BẠN
const supabaseKey = 'YOUR_SUPABASE_ANON_KEY'; // THAY THẾ BẰNG ANON KEY SUPABASE CỦA BẠN
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
    const fileContent = fs.readFileSync(dataFilePath, 'utf8');
    cachedData = JSON.parse(fileContent);
    if (cachedData.length > 0) {
        headerOrder = Object.keys(cachedData[0]); 
    }
    console.log('Dữ liệu đã được tải và cache.');
  } catch (error) {
    console.error('Không thể đọc hoặc parse data.json:', error);
    cachedData = []; 
  }
}

loadDataFromFile();

function convertYYYYMMDDToExcelSerial(yyyymmdd) {
    if (!yyyymmdd || !/^\d{4}-\d{2}-\d{2}$/.test(yyyymmdd)) {
        return null; 
    }
    const [year, month, day] = yyyymmdd.split('-').map(Number);
    const dateObj = new Date(Date.UTC(year, month - 1, day)); 
    const excelEpoch = new Date(Date.UTC(1899, 11, 30)); 
    return Math.floor((dateObj - excelEpoch) / (24 * 60 * 60 * 1000));
}

app.get('/search', (req, res) => {
  let results = [...cachedData]; 
  const params = req.query;
  const dateColumns = ['PO received date', 'Customer need date', 'Submit date'];

  for (const key in params) {
    if (key !== 'limit' && key !== 'offset' && params[key]) {
      const isDateRangeStart = key.endsWith('_start');
      const isDateRangeEnd = key.endsWith('_end');
      const baseKey = isDateRangeStart ? key.slice(0, -6) : (isDateRangeEnd ? key.slice(0, -4) : key);

      if (dateColumns.includes(baseKey)) {
        // Xử lý tìm kiếm khoảng ngày
        results = results.filter(item => {
          if (item[baseKey] === undefined || item[baseKey] === null) return false;
          const itemSerialDate = item[baseKey]; // Dữ liệu ngày trong JSON là số serial

          const startDateSerial = params[`${baseKey}_start`] ? convertYYYYMMDDToExcelSerial(params[`${baseKey}_start`]) : null;
          const endDateSerial = params[`${baseKey}_end`] ? convertYYYYMMDDToExcelSerial(params[`${baseKey}_end`]) : null;

          let match = true;
          if (startDateSerial !== null) {
            match = match && (itemSerialDate >= startDateSerial);
          }
          if (endDateSerial !== null) {
            match = match && (itemSerialDate <= endDateSerial);
          }
          return match;
        });
      } else if (!key.endsWith('_start') && !key.endsWith('_end')) { // Chỉ xử lý nếu không phải là _start hoặc _end của cột ngày
        // Xử lý cho các cột khác (so sánh chuỗi không phân biệt chữ hoa/thường)
        let queryValues = params[key].split(',');
        results = results.filter(item => {
          if (item[key] === undefined || item[key] === null) {
            return false;
          }
          const itemStr = item[key].toString().toLowerCase();
          return queryValues.some(qVal => itemStr.includes(qVal.toLowerCase()));
        });
      }
    }
  }

  const total = results.length;
  const limit = parseInt(params.limit) || 50;
  const offset = parseInt(params.offset) || 0;
  results = results.slice(offset, offset + limit);

  res.json({ data: results, total: total });
});


app.get('/filters', (req, res) => {
  if (!cachedData || cachedData.length === 0) {
    return res.json({});
  }
  const distinctValues = {};
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


app.get('/export', (req, res) => {
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
          if (item[baseKey] === undefined || item[baseKey] === null) return false;
          const itemSerialDate = item[baseKey];

          const startDateSerial = params[`${baseKey}_start`] ? convertYYYYMMDDToExcelSerial(params[`${baseKey}_start`]) : null;
          const endDateSerial = params[`${baseKey}_end`] ? convertYYYYMMDDToExcelSerial(params[`${baseKey}_end`]) : null;
          
          let match = true;
          if (startDateSerial !== null) {
            match = match && (itemSerialDate >= startDateSerial);
          }
          if (endDateSerial !== null) {
            match = match && (itemSerialDate <= endDateSerial);
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
  
  function formatExcelDateForOutput(serial) {
      if (typeof serial !== 'number' || isNaN(serial)) return serial; 
      const date = XLSX.SSF.parse_date_code(serial);
      if (date) {
          return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
      }
      return serial; 
  }

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

  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });

  res.setHeader('Content-Disposition', 'attachment; filename="exported_data.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(excelBuffer);
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'home.html'));
});

app.get('/tasks', (req, res) => {
    res.sendFile(path.join(__dirname, 'tasks.html'));
});

app.get('/voice_search', (req, res) => {
    res.sendFile(path.join(__dirname, 'voice_search.html'));
});

app.get('/api/tasks', async (req, res) => {
    try {
        const { data, error } = await supabase.from('tasks').select('*');
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/tasks', async (req, res) => {
    try {
        const { task_name, description, due_date, priority, status, assigned_to, project_id } = req.body;
        const { data, error } = await supabase
            .from('tasks')
            .insert([{ task_name, description, due_date, priority, status, assigned_to, project_id }])
            .select(); 

        if (error) throw error;
        res.status(201).json(data[0]); 
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/tasks/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body; 

        const { data, error } = await supabase
            .from('tasks')
            .update(updates)
            .eq('id', id)
            .select(); 

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

app.delete('/api/tasks/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { data, error } = await supabase.from('tasks').delete().eq('id', id);
        if (error) throw error;
        res.status(204).send(); 
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/users', async (req, res) => {
    try {
        const { data, error } = await supabase.from('profiles').select('id, username'); 
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/projects', async (req, res) => {
    try {
        const { data, error } = await supabase.from('projects').select('id, project_name');
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/tasks/:taskId/attachments', upload.single('attachmentFile'), async (req, res) => {
    const { taskId } = req.params;
    const file = req.file;

    if (!file) {
        return res.status(400).json({ message: 'No file uploaded.' });
    }

    try {
        const filePath = `task_${taskId}/${Date.now()}_${file.originalname}`;
        const { data: uploadData, error: uploadError } = await supabase.storage
            .from('tasks-attachments') 
            .upload(filePath, file.buffer, {
                contentType: file.mimetype,
                upsert: false,
            });

        if (uploadError) throw uploadError;

        const { data: publicUrlData } = supabase.storage
            .from('tasks-attachments')
            .getPublicUrl(filePath);

        const { data: dbData, error: dbError } = await supabase
            .from('task_attachments')
            .insert({
                task_id: taskId,
                file_name: file.originalname,
                file_path: filePath, 
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

app.delete('/api/attachments/:id', async (req, res) => {
  const attachmentId = req.params.id;
  try {
    const { data: attData, error: attError } = await supabase
      .from('task_attachments')
      .select('*')
      .eq('id', attachmentId)
      .single();
    if (attError) throw attError;
    if (!attData) {
      return res.json({ success: false, message: "Không tìm thấy attachment" });
    }

    if (attData.file_path) {
      console.log("Deleting attachment file:", attData.file_path);
      const { error: storageError } = await supabase
        .storage
        .from('tasks-attachments') 
        .remove([attData.file_path]);
      if (storageError) {
        console.error("Error removing file from storage:", storageError);
      }
    }

    const { error: delError } = await supabase
      .from('task_attachments')
      .delete()
      .eq('id', attachmentId);
    if (delError) throw delError;

    return res.json({ success: true, message: "Attachment deleted successfully!" });
  } catch (error) {
    console.error("Error deleting attachment:", error);
    return res.json({ success: false, message: error.message || "Failed to delete attachment" });
  }
});


app.listen(port, () => {
  console.log(`Server đang chạy tại http://localhost:${port}`);
});
