const express = require('express');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const cookieSession = require('cookie-session');
const multer = require('multer');
const compression = require('compression');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const port = process.env.PORT || 3000;

// ---------------------- MIDDLEWARE ----------------------
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieSession({
  name: 'session',
  keys: ['your-very-secret-key-CHANGE-THIS'],
  maxAge: 24 * 60 * 60 * 1000
}));
app.use(express.static(path.join(__dirname, 'public')));
const upload = multer({ storage: multer.memoryStorage() });

// ---------------------- SUPABASE ----------------------
let supabase;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
if(supabaseUrl && supabaseKey){
  supabase = createClient(supabaseUrl,supabaseKey);
  console.log("✅ Supabase initialized");
}else{
  console.warn("⚠️ SUPABASE_URL or SUPABASE_KEY not set. Supabase features disabled.");
  supabase = {
    from: () => ({
      select: async()=>({ data:[], error:{ message:"Supabase not configured" } }),
      insert: async()=>({ data:[], error:{ message:"Supabase not configured" } }),
      update: async()=>({ data:[], error:{ message:"Supabase not configured" } }),
      delete: async()=>({ data:[], error:{ message:"Supabase not configured" } }),
      eq: () => this,
      single: async()=>({ data:null, error:{ message:"Supabase not configured" } })
    }),
    storage: {
      from: () => ({
        upload: async()=>({ data:null, error:{ message:"Supabase not configured" } }),
        remove: async()=>({ data:null, error:{ message:"Supabase not configured" } }),
        getPublicUrl: () => ({ data:{ publicUrl:"" }, error:null })
      })
    }
  };
}

// ---------------------- LOAD DATA ----------------------
let cachedData = [];
let headerOrder = [];
let usersData = [];

function loadData(){
  try{
    cachedData = require('./data.json');
    const headers = new Set();
    cachedData.forEach(r => Object.keys(r).forEach(k=>headers.add(k)));
    headerOrder = Array.from(headers);
    console.log(`✅ Loaded data.json (${cachedData.length} records)`);
  }catch(e){ cachedData=[]; headerOrder=[]; console.error("Failed to load data.json", e); }
}

function loadUsers(){
  try{
    usersData = require('./users.json');
    console.log(`✅ Loaded users.json (${usersData.length} users)`);
  }catch(e){ usersData=[]; console.error("Failed to load users.json", e); }
}

loadData();
loadUsers();

// ---------------------- AUTH ----------------------
function isAuthenticated(req,res,next){ if(req.session.user) return next(); res.redirect('/login.html'); }
function isAdmin(req,res,next){ if(req.session.user?.role==='admin') return next(); res.status(403).json({success:false,message:"Admin required"}); }

// ---------------------- LOGIN/LOGOUT ----------------------
app.post('/login',(req,res)=>{
  const {identifier,password}=req.body;
  const user = usersData.find(u=>
    (u.name && u.name.toLowerCase()===identifier.toLowerCase()) ||
    (u.email && u.email.toLowerCase()===identifier.toLowerCase())
  );
  if(!user || user.password!==password) return res.json({success:false,message:"Invalid credentials"});
  req.session.user={name:user.name,email:user.email,role:user.role};
  res.json({success:true,user:req.session.user});
});
app.get('/logout',(req,res)=>{ req.session=null; res.redirect('/login.html'); });
app.get('/api/me',(req,res)=>{ res.json({success:!!req.session.user, user:req.session.user||null}); });

// ---------------------- VIEWS ----------------------
app.get(['/home','/home.html'],isAuthenticated,(req,res)=>res.sendFile(path.join(__dirname,'views','home.html')));
app.get(['/tasks','/tasks.html'],isAuthenticated,(req,res)=>res.sendFile(path.join(__dirname,'views','tasks.html')));
app.get(['/voice_search','/voice_search.html'],isAuthenticated,(req,res)=>res.sendFile(path.join(__dirname,'views','voice_search.html')));

// ---------------------- ACTIVE USERS ----------------------
const activeUsers = new Map();
app.use((req,res,next)=>{
  if(req.session.user) activeUsers.set(req.session.user.name,Date.now());
  next();
});
app.get('/api/active-users', isAdmin,(req,res)=>{
  const now = Date.now();
  const threshold = 2*60*1000;
  const online = [];
  activeUsers.forEach((lastSeen,name)=>{ if(now-lastSeen<threshold) online.push(name); });
  res.json({success:true,users:online});
});

// ---------------------- DATA API ----------------------
app.get('/api/data', isAuthenticated,(req,res)=>res.json(cachedData));
app.get('/filters', isAuthenticated,(req,res)=>{
  if(!cachedData.length) return res.json({});
  const distinctValues={};
  const filterCols=['Customer'];
  filterCols.forEach(col=>{
    const set=new Set();
    cachedData.forEach(r=>{ if(r[col]) set.add(r[col].toString().trim()); });
    distinctValues[col]=Array.from(set).sort((a,b)=>a.localeCompare(b,'vi'));
  });
  res.json(distinctValues);
});

// ---------------------- SEARCH ----------------------
function convertYYYYMMDDToExcelSerial(yyyymmdd){
  if(!yyyymmdd||!/^\d{4}-\d{2}-\d{2}$/.test(yyyymmdd)) return null;
  const [y,m,d]=yyyymmdd.split('-').map(Number);
  const dateObj=new Date(Date.UTC(y,m-1,d));
  const epoch=new Date(Date.UTC(1899,11,30));
  return Math.floor((dateObj-epoch)/(24*60*60*1000));
}

app.get('/search', isAuthenticated,(req,res)=>{
  let results=[...cachedData];
  const params=req.query;
  const dateCols=['PO received date','Customer need date','Submit date'];
  for(const key in params){
    if(key!=='limit' && key!=='offset' && params[key]){
      const isStart=key.endsWith('_start');
      const isEnd=key.endsWith('_end');
      const baseKey=isStart?key.slice(0,-6):isEnd?key.slice(0,-4):key;
      if(dateCols.includes(baseKey)){
        results = results.filter(r=>{
          if(!r[baseKey]) return false;
          const serial=typeof r[baseKey]==='number'?r[baseKey]:convertYYYYMMDDToExcelSerial(r[baseKey].toString());
          if(serial===null) return false;
          const start=params[`${baseKey}_start`] ? convertYYYYMMDDToExcelSerial(params[`${baseKey}_start`]):null;
          const end=params[`${baseKey}_end`] ? convertYYYYMMDDToExcelSerial(params[`${baseKey}_end`]):null;
          let ok=true;
          if(start!==null) ok=ok&&(serial>=start);
          if(end!==null) ok=ok&&(serial<=end);
          return ok;
        });
      } else if(!isStart && !isEnd){
        const qvals=params[key].split(',');
        results = results.filter(r=>r[key] && qvals.some(v=>r[key].toString().toLowerCase().includes(v.toLowerCase())));
      }
    }
  }
  const total = results.length;
  const limit = parseInt(params.limit)||50;
  const offset = parseInt(params.offset)||0;
  res.json({data:results.slice(offset,offset+limit),total});
});

// ---------------------- EXPORT EXCEL ----------------------
app.get('/export',isAuthenticated,(req,res)=>{
  let results=[...cachedData];
  const params=req.query;
  const dateCols=['PO received date','Customer need date','Submit date'];

  for(const key in params){
    if(params[key]){
      const isStart=key.endsWith('_start');
      const isEnd=key.endsWith('_end');
      const baseKey=isStart?key.slice(0,-6):isEnd?key.slice(0,-4):key;
      if(dateCols.includes(baseKey)){
        results = results.filter(r=>{
          if(!r[baseKey]) return false;
          const serial=typeof r[baseKey]==='number'?r[baseKey]:convertYYYYMMDDToExcelSerial(r[baseKey].toString());
          if(serial===null) return false;
          const start=params[`${baseKey}_start`] ? convertYYYYMMDDToExcelSerial(params[`${baseKey}_start`]):null;
          const end=params[`${baseKey}_end`] ? convertYYYYMMDDToExcelSerial(params[`${baseKey}_end`]):null;
          let ok=true;
          if(start!==null) ok=ok&&(serial>=start);
          if(end!==null) ok=ok&&(serial<=end);
          return ok;
        });
      } else if(!isStart && !isEnd){
        const qvals=params[key].split(',');
        results = results.filter(r=>r[key] && qvals.some(v=>r[key].toString().toLowerCase().includes(v.toLowerCase())));
      }
    }
  }

  function formatExcelDate(serialOrStr){
    if(typeof serialOrStr==='string' && /^\d{4}-\d{2}-\d{2}$/.test(serialOrStr)) return serialOrStr;
    if(typeof serialOrStr!=='number' || isNaN(serialOrStr)) return serialOrStr;
    const d=XLSX.SSF.parse_date_code(serialOrStr);
    return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
  }

  const formatted = results.map(r=>{
    const row={...r};
    dateCols.forEach(c=>{ row[c]=row[c]?formatExcelDate(row[c]):""; });
    return row;
  });

  const ws = XLSX.utils.json_to_sheet(formatted,{header:headerOrder});
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,"Results");
  const buffer = XLSX.write(wb,{bookType:'xlsx',type:'buffer'});
  res.setHeader('Content-Disposition','attachment; filename="exported_data.xlsx"');
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

// ---------------------- START SERVER ----------------------
app.listen(port,()=>console.log(`Server running on port ${port}`));
module.exports=app;
