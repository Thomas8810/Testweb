const express = require('express');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const cookieSession = require('cookie-session');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const compression = require('compression');

const app = express();
const port = process.env.PORT || 3000;

// -------------------- COMPRESSION --------------------
app.use(compression());

// -------------------- COOKIE-SESSION --------------------
app.use(cookieSession({
  name: 'session',
  keys: ['your-very-secret-key-CHANGE-THIS'],
  maxAge: 24 * 60 * 60 * 1000
}));

// -------------------- BODY PARSER --------------------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// -------------------- STATIC FILES --------------------
app.use(express.static(path.join(__dirname, 'public')));

// -------------------- SUPABASE CLIENT --------------------
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
let supabase;
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log("✅ Supabase initialized");
} else {
  console.warn("⚠️ Supabase not configured, DB features will not work");
  supabase = { from: () => ({ select: async()=>({data:[],error:null}) }) }; 
}

// -------------------- MULTER --------------------
const storage = multer.memoryStorage();
const upload = multer({ storage });

// -------------------- ACTIVE USERS --------------------
const activeUsers = new Map();
app.use((req, res, next) => {
  if (req.session?.user) activeUsers.set(req.session.user.name, Date.now());
  next();
});

// -------------------- LOAD DATA --------------------
let cachedData = [];
let headerOrder = [];
function loadData() {
  try {
    cachedData = require('./data.json');
    if (cachedData.length > 0) {
      const keys = new Set();
      cachedData.forEach(row => Object.keys(row).forEach(k => keys.add(k)));
      headerOrder = Array.from(keys);
    } else {
      headerOrder = [];
    }
    console.log(`✅ Loaded data.json: ${cachedData.length} records`);
  } catch (err) {
    console.error("❌ Error loading data.json:", err.message);
    cachedData = [];
    headerOrder = [];
  }
}
loadData();

let usersData = [];
function loadUsers() {
  try {
    usersData = require('./users.json');
    console.log(`✅ Loaded users.json: ${usersData.length} users`);
  } catch (err) {
    console.error("❌ Error loading users.json:", err.message);
    usersData = [];
  }
}
loadUsers();

// -------------------- AUTH MIDDLEWARE --------------------
function isAuthenticated(req, res, next) {
  if (req.session?.user) return next();
  res.redirect('/login.html');
}

function isAdmin(req, res, next) {
  if (req.session?.user?.role === 'admin') return next();
  res.status(403).json({ success: false, message: "Admin privileges required" });
}

// -------------------- LOGIN / LOGOUT --------------------
app.post('/login', (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) return res.json({ success:false, message:"Missing fields" });

  const user = usersData.find(u => 
    (u.name?.toLowerCase()===identifier.toLowerCase() || u.email?.toLowerCase()===identifier.toLowerCase())
  );
  if (!user) return res.json({ success:false, message:"User not found" });
  if (user.password !== password) return res.json({ success:false, message:"Incorrect password" });

  req.session.user = { name:user.name, email:user.email, role:user.role };
  res.json({ success:true, user:req.session.user });
});

app.get('/logout', (req, res) => {
  req.session = null;
  res.redirect('/login.html');
});

// -------------------- GET CURRENT USER --------------------
app.get('/api/me', (req, res) => {
  if (!req.session?.user) return res.json({ success:false });
  res.json({ success:true, user:req.session.user });
});

// -------------------- STATIC & VIEW ROUTES --------------------
app.get('/home.html', isAuthenticated, (req, res) => res.sendFile(path.join(__dirname,'views','home.html')));
app.get('/tasks.html', isAuthenticated, (req, res) => res.sendFile(path.join(__dirname,'views','tasks.html')));
app.get('/voice_search.html', isAuthenticated, (req, res) => res.sendFile(path.join(__dirname,'views','voice_search.html')));

// -------------------- ACTIVE USERS API --------------------
app.get('/api/active-users', isAdmin, (req,res)=>{
  const now = Date.now();
  const threshold = 2*60*1000; // 2 phút
  const online = [];
  activeUsers.forEach((time,name)=>{ if(now-time<threshold) online.push(name); });
  res.json({success:true, users:online});
});

// -------------------- FILTERS --------------------
app.get('/filters', isAuthenticated, (req,res)=>{
  if(!cachedData.length) return res.json({});
  const distinct = {};
  const columns=['Customer'];
  columns.forEach(col=>{
    const s=new Set();
    cachedData.forEach(item=>{
      if(item[col]!==undefined && item[col]!==null && item[col].toString().trim()!=='') s.add(item[col].toString().trim());
    });
    distinct[col]=Array.from(s).sort((a,b)=>a.localeCompare(b,'vi'));
  });
  res.json(distinct);
});

// -------------------- DATA API --------------------
app.get('/api/data', isAuthenticated, (req,res)=> res.json(cachedData));

// -------------------- SEARCH --------------------
function excelDate(serial){
  if(!serial || typeof serial!=='string') return null;
  const m = serial.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m) return null;
  const d = new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));
  return Math.floor((d - new Date(Date.UTC(1899,11,30)))/(24*60*60*1000));
}

app.get('/search', isAuthenticated, (req,res)=>{
  let results=[...cachedData];
  const params=req.query;
  const dateCols=['PO received date','Customer need date','Submit date'];

  for(const key in params){
    if(!params[key]) continue;
    const isStart = key.endsWith('_start');
    const isEnd = key.endsWith('_end');
    const baseKey = isStart? key.slice(0,-6): isEnd? key.slice(0,-4): key;

    if(dateCols.includes(baseKey)){
      const startSerial = params[`${baseKey}_start`]? excelDate(params[`${baseKey}_start`]):null;
      const endSerial = params[`${baseKey}_end`]? excelDate(params[`${baseKey}_end`]):null;
      results = results.filter(item=>{
        if(!item[baseKey]) return false;
        const itemSerial=typeof item[baseKey]==='number'?item[baseKey]:excelDate(item[baseKey].toString());
        if(itemSerial===null) return false;
        if(startSerial!==null && itemSerial<startSerial) return false;
        if(endSerial!==null && itemSerial>endSerial) return false;
        return true;
      });
    } else if(!isStart && !isEnd){
      const vals=params[key].split(',');
      results=results.filter(item=>{
        if(!item[key]) return false;
        const s=item[key].toString().toLowerCase();
        return vals.some(v=>s.includes(v.toLowerCase()));
      });
    }
  }

  const total=results.length;
  const limit=parseInt(params.limit)||50;
  const offset=parseInt(params.offset)||0;
  res.json({data:results.slice(offset,offset+limit), total});
});

// -------------------- EXPORT --------------------
app.get('/export', isAuthenticated, (req,res)=>{
  let results=[...cachedData];
  const params=req.query;
  const dateCols=['PO received date','Customer need date','Submit date'];

  for(const key in params){
    if(!params[key]) continue;
    const isStart = key.endsWith('_start');
    const isEnd = key.endsWith('_end');
    const baseKey = isStart? key.slice(0,-6): isEnd? key.slice(0,-4): key;

    if(dateCols.includes(baseKey)){
      const startSerial = params[`${baseKey}_start`]? excelDate(params[`${baseKey}_start`]):null;
      const endSerial = params[`${baseKey}_end`]? excelDate(params[`${baseKey}_end`]):null;
      results = results.filter(item=>{
        if(!item[baseKey]) return false;
        const itemSerial=typeof item[baseKey]==='number'?item[baseKey]:excelDate(item[baseKey].toString());
        if(itemSerial===null) return false;
        if(startSerial!==null && itemSerial<startSerial) return false;
        if(endSerial!==null && itemSerial>endSerial) return false;
        return true;
      });
    } else if(!isStart && !isEnd){
      const vals=params[key].split(',');
      results=results.filter(item=>{
        if(!item[key]) return false;
        const s=item[key].toString().toLowerCase();
        return vals.some(v=>s.includes(v.toLowerCase()));
      });
    }
  }

  function fmtExcel(d){
    if(typeof d==='string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    if(typeof d!=='number' || isNaN(d)) return d;
    const date = XLSX.SSF.parse_date_code(d);
    if(date) return `${date.y}-${String(date.m).padStart(2,'0')}-${String(date.d).padStart(2,'0')}`;
    return d;
  }

  const formatted = results.map(r=>{
    const nr={...r};
    dateCols.forEach(c=>{
      nr[c]=nr[c]? fmtExcel(nr[c]):"";
    });
    return nr;
  });

  const ws=XLSX.utils.json_to_sheet(formatted,{header:headerOrder});
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Results');
  const buffer=XLSX.write(wb,{bookType:'xlsx',type:'buffer'});
  res.setHeader('Content-Disposition','attachment; filename="exported_data.xlsx"');
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});
// -------------------- SUPABASE INIT --------------------
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
let supabase;
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log("✅ Supabase initialized");
} else {
  console.warn("⚠️ Supabase not configured. Tasks page will not work.");
  supabase = {
    from: ()=>({ select: async()=>({data:[],error:{message:"Supabase not configured"}}), insert: async()=>({data:[],error:{message:"Supabase not configured"}}), update: async()=>({data:[],error:{message:"Supabase not configured"}}), delete: async()=>({data:[],error:{message:"Supabase not configured"}}), eq: ()=>{}, order: ()=>{}, single: async()=>({data:null,error:{message:"Supabase not configured"}}) }),
    storage: { from: ()=>({ upload: async()=>({data:null,error:{message:"Supabase not configured"}}), remove: async()=>({data:null,error:{message:"Supabase not configured"}}), getPublicUrl: ()=>({data:{publicUrl:""}, error:null}) }) }
  };
}

// -------------------- TASK HISTORY LOG --------------------
async function logTaskHistory(taskId, user, action, oldVal, newVal){
  if(!supabaseUrl || !supabaseKey) return;
  try{
    const {data,error}=await supabase.from('task_history').insert([{task_id:taskId, changed_by:user, action, old_value:oldVal, new_value:newVal}]).select();
    if(error) console.error("Error logging task history:", error);
    return data;
  } catch(e){ console.error("Exception logging task history:", e); }
}

// -------------------- TASKS --------------------
app.get('/api/tasks', isAuthenticated, async (req,res)=>{
  if(!supabaseUrl || !supabaseKey) return res.status(503).json({success:false,message:"Supabase not configured"});
  try{
    let query = supabase.from('tasks').select('*').order('id',{ascending:true});
    if(req.session.user.role!=='admin') query=query.eq('assignedTo',req.session.user.name);
    else if(req.query.assignedTo) query=query.eq('assignedTo',req.query.assignedTo);
    const {data,error}=await query;
    if(error) throw error;
    res.json(data||[]);
  } catch(e){ console.error(e); res.status(500).json({success:false,message:e.message||JSON.stringify(e)}); }
});

app.post('/api/tasks', isAuthenticated, isAdmin, async(req,res)=>{
  if(!supabaseUrl || !supabaseKey) return res.status(503).json({success:false,message:"Supabase not configured"});
  try{
    const {title, assignedTo, priority, deadline, description, status='Chưa thực hiện', imageURL, image_path}=req.body;
    const {data,error}=await supabase.from('tasks').insert([{title,assignedTo,priority,deadline,description,status,imageURL,image_path,created_by:req.session.user.name}]).select();
    if(error) throw error;
    await logTaskHistory(data[0].id, req.session.user.name,'Task created', null, JSON.stringify(data[0]));
    res.json({success:true, task:data[0]});
  } catch(e){ console.error(e); res.status(500).json({success:false,message:e.message||JSON.stringify(e)}); }
});

app.put('/api/tasks/:id', isAuthenticated, async(req,res)=>{
  if(!supabaseUrl || !supabaseKey) return res.status(503).json({success:false,message:"Supabase not configured"});
  const taskId=req.params.id;
  try{
    const {data:task,error:selErr}=await supabase.from('tasks').select('*').eq('id',taskId).single();
    if(selErr) throw selErr;
    if(!task) return res.status(404).json({success:false,message:"Task not found"});
    if(req.session.user.role!=='admin' && task.assignedTo!==req.session.user.name && task.created_by!==req.session.user.name) return res.status(403).json({success:false,message:"Không có quyền"});
    
    let updatePayload={...req.body};
    if(req.session.user.role!=='admin') delete updatePayload.assignedTo;
    const oldVal=JSON.stringify(task);
    const {data:updated,error:updErr}=await supabase.from('tasks').update(updatePayload).eq('id',taskId).select();
    if(updErr) throw updErr;
    await logTaskHistory(taskId, req.session.user.name,'Task updated', oldVal, JSON.stringify(updated[0]));
    res.json({success:true, task:updated[0]});
  } catch(e){ console.error(e); res.status(500).json({success:false,message:e.message||JSON.stringify(e)}); }
});

app.delete('/api/tasks/:id', isAuthenticated, isAdmin, async(req,res)=>{
  if(!supabaseUrl || !supabaseKey) return res.status(503).json({success:false,message:"Supabase not configured"});
  const taskId=req.params.id;
  try{
    const {data:task,error:fetchErr}=await supabase.from('tasks').select('*').eq('id',taskId).single();
    if(fetchErr||!task) return res.status(404).json({success:false,message:"Task not found"});
    
    // delete attachments
    const {data:atts,error:attErr}=await supabase.from('task_attachments').select('file_path').eq('task_id',taskId);
    if(atts?.length>0){
      const paths=atts.map(a=>a.file_path).filter(Boolean);
      if(paths.length>0) await supabase.storage.from('tasks-attachments').remove(paths);
    }
    await supabase.from('task_attachments').delete().eq('task_id',taskId);
    await supabase.from('task_comments').delete().eq('task_id',taskId);
    await supabase.from('task_history').delete().eq('task_id',taskId);
    const {error:delErr}=await supabase.from('tasks').delete().eq('id',taskId);
    if(delErr) throw delErr;
    await logTaskHistory(taskId, req.session.user.name,'Task deleted', JSON.stringify(task), null);
    res.json({success:true,message:"Deleted"});
  } catch(e){ console.error(e); res.status(500).json({success:false,message:e.message||JSON.stringify(e)}); }
});

// -------------------- COMMENTS --------------------
app.get('/api/tasks/:taskId/comments', isAuthenticated, async(req,res)=>{
  if(!supabaseUrl || !supabaseKey) return res.status(503).json({success:false,message:"Supabase not configured"});
  const {taskId}=req.params;
  try{
    const {data,error}=await supabase.from('task_comments').select('*').eq('task_id',taskId).order('created_at',{ascending:true});
    if(error) throw error;
    res.json(data||[]);
  } catch(e){ console.error(e); res.status(500).json({success:false,message:e.message}); }
});

app.post('/api/tasks/:taskId/comments', isAuthenticated, async(req,res)=>{
  if(!supabaseUrl || !supabaseKey) return res.status(503).json({success:false,message:"Supabase not configured"});
  const {taskId}=req.params;
  const {comment_text}=req.body;
  const userName=req.session.user.name || req.session.user.email;
  if(!comment_text || !comment_text.trim()) return res.status(400).json({success:false,message:"Comment empty"});
  try{
    const {data,error}=await supabase.from('task_comments').insert([{task_id:taskId,user:userName,comment_text:comment_text.trim()}]).select();
    if(error) throw error;
    res.json({success:true, comment:data[0]});
  } catch(e){ console.error(e); res.status(500).json({success:false,message:e.message}); }
});

// -------------------- ATTACHMENTS --------------------
app.post('/api/tasks/:taskId/attachments', isAuthenticated, upload.single('file'), async(req,res)=>{
  if(!supabaseUrl || !supabaseKey) return res.status(503).json({success:false,message:"Supabase not configured"});
  const {taskId}=req.params;
  try{
    if(!req.file) return res.status(400).json({success:false,message:"No file"});
    const filePath=`task_${taskId}/${Date.now()}_${req.file.originalname.replace(/\s+/g,'_')}`;
    const {data:upl,error:uplErr}=await supabase.storage.from('tasks-attachments').upload(filePath, req.file.buffer,{contentType:req.file.mimetype, upsert:false});
    if(uplErr) throw uplErr;
    const {data:pub}=supabase.storage.from('tasks-attachments').getPublicUrl(filePath);
    const {data:db,error:dbErr}=await supabase.from('task_attachments').insert([{task_id:taskId,file_name:req.file.originalname,file_url:pub.publicUrl,file_type:req.file.mimetype,file_path:filePath}]).select();
    if(dbErr) throw dbErr;
    res.json({success:true, attachment:db[0]});
  } catch(e){ console.error(e); res.status(500).json({success:false,message:e.message||JSON.stringify(e)}); }
});

app.get('/api/tasks/:taskId/attachments', isAuthenticated, async(req,res)=>{
  if(!supabaseUrl || !supabaseKey) return res.status(503).json({success:false,message:"Supabase not configured"});
  const {taskId}=req.params;
  try{
    const {data,error}=await supabase.from('task_attachments').select('*').eq('task_id',taskId).order('created_at',{ascending:true});
    if(error) throw error;
    res.json(data||[]);
  } catch(e){ console.error(e); res.status(500).json({success:false,message:e.message}); }
});

app.delete('/api/attachments/:attachmentId', isAuthenticated, isAdmin, async(req,res)=>{
  if(!supabaseUrl || !supabaseKey) return res.status(503).json({success:false,message:"Supabase not configured"});
  const {attachmentId}=req.params;
  try{
    const {data:att,error:fetchErr}=await supabase.from('task_attachments').select('file_path').eq('id',attachmentId).single();
    if(fetchErr || !att) return res.status(404).json({success:false,message:"Attachment not found"});
    if(att.file_path) await supabase.storage.from('tasks-attachments').remove([att.file_path]);
    const {error:dbErr}=await supabase.from('task_attachments').delete().eq('id',attachmentId);
    if(dbErr) throw dbErr;
    res.json({success:true,message:"Deleted"});
  } catch(e){ console.error(e); res.status(500).json({success:false,message:e.message}); }
});

// -------------------- START SERVER --------------------
app.listen(port,()=>console.log(`Server running on port ${port}`));

