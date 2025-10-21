const express = require('express');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const cookieSession = require('cookie-session');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const compression = require('compression');

const app = express();
const port = process.env.PORT || 3000;
const activeUsers = new Map();

// ------------------- Middleware -------------------
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieSession({
  name: 'session',
  keys: ['your-very-secret-key-CHANGE-THIS-PLEASE'],
  maxAge: 24 * 60 * 60 * 1000
}));

// ------------------- Load JSON -------------------
let cachedData = [];
let usersData = [];

try { cachedData = require('./data.json'); console.log(`✅ Loaded ${cachedData.length} records`); } 
catch(e){ console.error('❌ Cannot load data.json', e); }

try { usersData = require('./users.json'); console.log(`✅ Loaded ${usersData.length} users`); } 
catch(e){ console.error('❌ Cannot load users.json', e); }

// ------------------- Static files -------------------
// Vercel sẽ phục vụ public/ qua route, không cần express.static
// app.use(express.static(path.join(__dirname, 'public')));

// ------------------- Supabase -------------------
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// ------------------- Multer -------------------
const storage = multer.memoryStorage();
const upload = multer({ storage });

// ------------------- Middleware user tracking -------------------
app.use((req, res, next) => {
  if (req.session?.user) activeUsers.set(req.session.user.name, Date.now());
  next();
});

// ------------------- Auth Middleware -------------------
function isAuthenticated(req,res,next){
  if(req.session?.user) return next();
  return res.redirect('/login.html');
}
function isAdmin(req,res,next){
  if(req.session?.user?.role==='admin') return next();
  return res.status(403).json({ success:false, message:"Admin required" });
}

// ------------------- API: Login/Logout -------------------
app.post('/login', (req,res)=>{
  const {identifier,password} = req.body;
  const user = usersData.find(u=> (u.name?.toLowerCase()===identifier?.toLowerCase()) || (u.email?.toLowerCase()===identifier?.toLowerCase()));
  if(!user) return res.json({success:false,message:"User not found"});
  if(user.password!==password) return res.json({success:false,message:"Wrong password"});
  req.session.user={name:user.name,email:user.email,role:user.role};
  res.json({success:true,user:req.session.user});
});

app.get('/logout', (req,res)=>{
  req.session=null;
  res.redirect('/login.html');
});

app.get('/api/me',(req,res)=>{
  if(!req.session.user) return res.json({success:false});
  res.json({success:true,user:req.session.user});
});

// ------------------- API: Active users -------------------
app.get('/api/active-users', isAdmin,(req,res)=>{
  const now=Date.now(), threshold=2*60*1000;
  const online=[];
  activeUsers.forEach((last,name)=>{ if(now-last<threshold) online.push(name); });
  res.json({success:true,users:online});
});

// ------------------- API: Cached Data -------------------
app.get('/api/data', isAuthenticated, (req,res)=>{
  res.json(cachedData);
});
app.get('/filters', isAuthenticated,(req,res)=>{
  const filterable=['Customer'];
  const result={};
  filterable.forEach(col=>{
    const set=new Set();
    cachedData.forEach(item=>{ if(item[col]) set.add(item[col].toString().trim()); });
    result[col]=Array.from(set).sort((a,b)=>a.localeCompare(b,'vi'));
  });
  res.json(result);
});

// ------------------- API: Search -------------------
function convertYYYYMMDDToExcelSerial(d){
  if(!d||!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const [y,m,day]=d.split('-').map(Number);
  return Math.floor((new Date(Date.UTC(y,m-1,day))-new Date(Date.UTC(1899,11,30)))/(24*60*60*1000));
}

app.get('/search', isAuthenticated,(req,res)=>{
  let results=[...cachedData];
  const params=req.query;
  const dateCols=['PO received date','Customer need date','Submit date'];

  for(const key in params){
    if(!params[key]) continue;
    const isStart=key.endsWith('_start'), isEnd=key.endsWith('_end');
    const base=isStart?key.slice(0,-6):(isEnd?key.slice(0,-4):key);

    if(dateCols.includes(base)){
      results=results.filter(item=>{
        const itemDate=typeof item[base]==='number'?item[base]:convertYYYYMMDDToExcelSerial(item[base]?.toString());
        if(itemDate===null) return false;
        const start=params[`${base}_start`]?convertYYYYMMDDToExcelSerial(params[`${base}_start`]):null;
        const end=params[`${base}_end`]?convertYYYYMMDDToExcelSerial(params[`${base}_end`]):null;
        let match=true; if(start!==null) match=match&&itemDate>=start; if(end!==null) match=match&&itemDate<=end;
        return match;
      });
    } else if(!isStart && !isEnd){
      const query=params[key].split(',');
      results=results.filter(item=> item[key] && query.some(q=>item[key].toString().toLowerCase().includes(q.toLowerCase())));
    }
  }

  const total=results.length, limit=parseInt(params.limit)||50, offset=parseInt(params.offset)||0;
  res.json({data:results.slice(offset,offset+limit),total});
});

// ------------------- API: Export XLSX -------------------
app.get('/export', isAuthenticated,(req,res)=>{
  let results=[...cachedData];
  const params=req.query;
  const dateCols=['PO received date','Customer need date','Submit date'];

  // Filter same as search
  for(const key in params){
    if(!params[key]) continue;
    const isStart=key.endsWith('_start'), isEnd=key.endsWith('_end');
    const base=isStart?key.slice(0,-6):(isEnd?key.slice(0,-4):key);
    if(dateCols.includes(base)){
      results=results.filter(item=>{
        const itemDate=typeof item[base]==='number'?item[base]:convertYYYYMMDDToExcelSerial(item[base]?.toString());
        if(itemDate===null) return false;
        const start=params[`${base}_start`]?convertYYYYMMDDToExcelSerial(params[`${base}_start`]):null;
        const end=params[`${base}_end`]?convertYYYYMMDDToExcelSerial(params[`${base}_end`]):null;
        let match=true; if(start!==null) match=match&&itemDate>=start; if(end!==null) match=match&&itemDate<=end;
        return match;
      });
    } else if(!isStart && !isEnd){
      const query=params[key].split(',');
      results=results.filter(item=> item[key] && query.some(q=>item[key].toString().toLowerCase().includes(q.toLowerCase())));
    }
  }

  const worksheet=XLSX.utils.json_to_sheet(results,{header:Object.keys(cachedData[0]||{})});
  const workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,worksheet,"Results");
  const excelBuffer=XLSX.write(workbook,{bookType:'xlsx',type:'buffer'});
  res.setHeader('Content-Disposition','attachment; filename="exported_data.xlsx"');
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(excelBuffer);
});

// ------------------- TODO: Supabase Tasks/Comments/Attachments -------------------
// Giữ nguyên code cũ của anh, chỉ đảm bảo supabase client init như trên

// ------------------- Start server -------------------
app.listen(port,()=>{ console.log(`Server running on port ${port}`); });
module.exports=app;
