const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DB_FILE = process.env.DB_FILE || path.join(ROOT, 'data.json');
const DAILY_FEE = 6;
const COMMISSION = 0.08;

const seed = () => ({
  users: [
    { id:'passenger-demo', role:'passenger', name:'Cliente Demonstração', phone:'34999990001', token:'passageiro-demo' },
    { id:'driver-demo', role:'driver', name:'Carlos Mototáxi', phone:'34999990002', token:'motorista-demo', approved:true, online:false, balance:30, plate:'ABC1D23', rating:4.9, dailyFeeDate:null },
    { id:'admin-demo', role:'admin', name:'Administrador', phone:'34999990003', token:'admin-demo' }
  ],
  rides: [],
  transactions: [],
  settings: { dailyFee: DAILY_FEE, commission: COMMISSION, baseFare:5, perKm:2.25, minimumFare:10 }
});

function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { const db=seed(); saveDB(db); return db; }
}
function saveDB(db) {
  const temp = `${DB_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(db, null, 2));
  fs.renameSync(temp, DB_FILE);
}
function json(res, status, body) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(body));
}
function body(req) {
  return new Promise((resolve,reject)=>{ let raw=''; req.on('data',c=>{raw+=c; if(raw.length>8e6) reject(new Error('too_large'));}); req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{});}catch{reject(new Error('invalid_json'));}}); req.on('error',reject); });
}
function auth(req, db) {
  const token = (req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  return db.users.find(u=>u.token===token);
}
function today() { return new Date().toISOString().slice(0,10); }
function id(prefix) { return `${prefix}_${crypto.randomUUID().slice(0,8)}`; }
function publicUser(u) { const {token,...safe}=u; return safe; }
function safeUser(u) { const {token,passwordHash,passwordSalt,documents,...safe}=u; return safe; }
function normalizePhone(value) { return String(value||'').replace(/\D/g,''); }
function passwordDigest(password,salt) { return crypto.scryptSync(String(password),salt,32).toString('hex'); }
function ageFrom(date) { const born=new Date(`${date}T12:00:00`); if(Number.isNaN(born.getTime()))return 0; const now=new Date();let age=now.getFullYear()-born.getFullYear();if(now.getMonth()<born.getMonth()||(now.getMonth()===born.getMonth()&&now.getDate()<born.getDate()))age--;return age; }
function estimate(settings, km) { return Math.max(settings.minimumFare, settings.baseFare + Number(km||0)*settings.perKm); }

const geoCache = new Map();
async function geocode(address) {
  const key=address.toLowerCase().trim();
  if(geoCache.has(key)) return geoCache.get(key);
  const query=address.toLowerCase().includes('araxá')?address:`${address}, Araxá, MG, Brasil`;
  const target=new URL('https://nominatim.openstreetmap.org/search');
  target.search=new URLSearchParams({q:query,format:'jsonv2',limit:'1',countrycodes:'br'});
  const response=await fetch(target,{headers:{'User-Agent':'AraxaMoto-MVP/1.1',Accept:'application/json'},signal:AbortSignal.timeout(12000)});
  if(!response.ok) throw new Error('geocoding_unavailable');
  const list=await response.json();
  if(!list[0]) throw new Error('address_not_found');
  const point={lat:Number(list[0].lat),lon:Number(list[0].lon),label:list[0].display_name};
  geoCache.set(key,point);
  return point;
}
async function calculateRoute(origin,destination,originCoords) {
  const hasCoords=originCoords&&Number.isFinite(Number(originCoords.lat))&&Number.isFinite(Number(originCoords.lon));
  const from=hasCoords?{lat:Number(originCoords.lat),lon:Number(originCoords.lon),label:'Minha localização atual'}:await geocode(origin);
  const to=await geocode(destination);
  const target=`https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson&steps=false`;
  const response=await fetch(target,{headers:{'User-Agent':'AraxaMoto-MVP/1.1'},signal:AbortSignal.timeout(12000)});
  if(!response.ok) throw new Error('routing_unavailable');
  const result=await response.json(); const route=result.routes&&result.routes[0];
  if(!route) throw new Error('route_not_found');
  return {distanceKm:Number((route.distance/1000).toFixed(2)),durationMin:Math.max(1,Math.round(route.duration/60)),from,to,coordinates:route.geometry.coordinates.map(([lon,lat])=>[lat,lon])};
}

async function api(req,res,url) {
  const db=loadDB();
  if(req.method==='POST' && url.pathname==='/api/register') {
    const data=await body(req); const role=data.role==='driver'?'driver':'passenger'; const phone=normalizePhone(data.phone);
    if(String(data.name||'').trim().length<3)return json(res,400,{error:'Informe seu nome completo'});
    if(phone.length<10||phone.length>13)return json(res,400,{error:'Telefone inválido'});
    if(String(data.password||'').length<6)return json(res,400,{error:'A senha precisa ter pelo menos 6 caracteres'});
    if(db.users.some(u=>normalizePhone(u.phone)===phone))return json(res,409,{error:'Este telefone já está cadastrado'});
    if(role==='driver') {
      if(ageFrom(data.birthDate)<21)return json(res,400,{error:'O cadastro de mototaxista exige idade mínima de 21 anos'});
      if(!String(data.cnhCategory||'').toUpperCase().includes('A'))return json(res,400,{error:'A CNH precisa incluir a categoria A'});
      if(!data.cnhNumber||!data.cnhExpiry||!data.plate||!data.motorcycleModel)return json(res,400,{error:'Preencha CNH e dados da motocicleta'});
      if(!Array.isArray(data.documents)||data.documents.length<3)return json(res,400,{error:'Envie CNH, documento da moto e foto de perfil'});
      if(data.documents.some(d=>String(d.data||'').length>2200000))return json(res,413,{error:'Cada documento deve ter no máximo 1,5 MB'});
    }
    const salt=crypto.randomBytes(16).toString('hex'); const user={id:id(role),role,name:String(data.name).trim().slice(0,100),phone,passwordSalt:salt,passwordHash:passwordDigest(data.password,salt),token:crypto.randomBytes(24).toString('hex'),createdAt:new Date().toISOString()};
    if(role==='driver')Object.assign(user,{approved:false,reviewStatus:'pending',reviewNote:'',online:false,balance:0,rating:5,dailyFeeDate:null,birthDate:data.birthDate,cnhNumber:String(data.cnhNumber).slice(0,30),cnhCategory:String(data.cnhCategory).toUpperCase().slice(0,5),cnhExpiry:data.cnhExpiry,plate:String(data.plate).toUpperCase().slice(0,10),motorcycleModel:String(data.motorcycleModel).slice(0,80),motorcycleYear:String(data.motorcycleYear||'').slice(0,4),motorcycleColor:String(data.motorcycleColor||'').slice(0,30),pixKey:String(data.pixKey||'').slice(0,100),documents:data.documents.map(d=>({kind:String(d.kind).slice(0,30),name:String(d.name).slice(0,100),type:String(d.type).slice(0,60),data:String(d.data)}))});
    db.users.push(user);saveDB(db);return json(res,201,{token:user.token,user:safeUser(user)});
  }
  if(req.method==='POST' && url.pathname==='/api/login') {
    const data=await body(req);const phone=normalizePhone(data.phone);const user=db.users.find(u=>normalizePhone(u.phone)===phone&&u.passwordHash);
    if(!user||passwordDigest(data.password||'',user.passwordSalt)!==user.passwordHash)return json(res,401,{error:'Telefone ou senha incorretos'});
    user.token=crypto.randomBytes(24).toString('hex');saveDB(db);return json(res,200,{token:user.token,user:safeUser(user)});
  }
  if(req.method==='POST' && url.pathname==='/api/demo-login') {
    const data=await body(req); const user=db.users.find(u=>u.role===data.role);
    return user ? json(res,200,{token:user.token,user:publicUser(user)}) : json(res,404,{error:'Perfil não encontrado'});
  }
  const user=auth(req,db);
  if(!user) return json(res,401,{error:'Sessão inválida'});
  if(req.method==='GET' && url.pathname==='/api/me') return json(res,200,{user:safeUser(user),settings:db.settings});
  if(req.method==='POST' && url.pathname==='/api/route') {
    const data=await body(req);
    if(!data.destination||(!data.origin&&!data.originCoords)) return json(res,400,{error:'Informe origem e destino'});
    try {
      const route=await calculateRoute(String(data.origin||''),String(data.destination),data.originCoords);
      return json(res,200,{route:{...route,price:Number(estimate(db.settings,route.distanceKm).toFixed(2))}});
    } catch(error) {
      const messages={address_not_found:'Endereço não encontrado em Araxá',route_not_found:'Não foi possível criar uma rota',geocoding_unavailable:'Busca de endereço indisponível',routing_unavailable:'Cálculo de rota indisponível'};
      return json(res,502,{error:messages[error.message]||'Mapa temporariamente indisponível'});
    }
  }
  if(req.method==='GET' && url.pathname==='/api/rides') {
    const rides=user.role==='admin'?db.rides:user.role==='driver'?db.rides.filter(r=>r.driverId===user.id||r.status==='searching'):db.rides.filter(r=>r.passengerId===user.id);
    return json(res,200,{rides:rides.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),settings:db.settings});
  }
  if(req.method==='POST' && url.pathname==='/api/rides') {
    if(user.role!=='passenger'&&user.role!=='admin') return json(res,403,{error:'Apenas clientes ou a central podem solicitar'});
    const data=await body(req); const km=Math.max(.5,Math.min(100,Number(data.distanceKm)||0));
    if(!Number.isFinite(Number(data.distanceKm))||Number(data.distanceKm)<=0) return json(res,400,{error:'Calcule a rota antes de solicitar'});
    if(!data.origin||!data.destination) return json(res,400,{error:'Informe origem e destino'});
    const price=Number(estimate(db.settings,km).toFixed(2));
    const ride={id:id('corrida'),type:data.type==='delivery'?'delivery':'ride',passengerId:user.role==='passenger'?user.id:'passenger-demo',passengerName:user.name,origin:String(data.origin).slice(0,120),destination:String(data.destination).slice(0,120),distanceKm:km,durationMin:Math.max(1,Math.min(300,Number(data.durationMin)||1)),routeCoordinates:Array.isArray(data.routeCoordinates)?data.routeCoordinates.slice(0,2000):[],notes:String(data.notes||'').slice(0,240),payment:data.payment==='cash'?'cash':'pix',price,status:'searching',driverId:null,driverName:null,code:String(Math.floor(1000+Math.random()*9000)),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    db.rides.push(ride); saveDB(db); return json(res,201,{ride});
  }
  const match=url.pathname.match(/^\/api\/rides\/([^/]+)\/(accept|advance|cancel)$/);
  if(req.method==='POST'&&match) {
    const ride=db.rides.find(r=>r.id===match[1]); if(!ride)return json(res,404,{error:'Serviço não encontrado'});
    const action=match[2];
    if(action==='accept') {
      if(user.role!=='driver'||!user.approved)return json(res,403,{error:'Condutor não aprovado'});
      if(!user.online)return json(res,409,{error:'Fique online antes de aceitar'});
      if(ride.status!=='searching')return json(res,409,{error:'Serviço já aceito'});
      ride.driverId=user.id; ride.driverName=user.name; ride.status='accepted';
    } else if(action==='advance') {
      if(user.role!=='admin'&&ride.driverId!==user.id)return json(res,403,{error:'Sem permissão'});
      const next={accepted:'arriving',arriving:'arrived',arrived:'in_progress',in_progress:'completed'};
      if(!next[ride.status])return json(res,409,{error:'Não é possível avançar este serviço'});
      ride.status=next[ride.status];
      if(ride.status==='completed') {
        const driver=db.users.find(u=>u.id===ride.driverId); const fee=Number((ride.price*db.settings.commission).toFixed(2));
        if(driver){driver.balance=Number((driver.balance-fee).toFixed(2)); db.transactions.push({id:id('tx'),driverId:driver.id,type:'commission',amount:-fee,rideId:ride.id,createdAt:new Date().toISOString()});}
      }
    } else {
      if(user.role!=='admin'&&ride.passengerId!==user.id&&ride.driverId!==user.id)return json(res,403,{error:'Sem permissão'});
      if(ride.status==='completed')return json(res,409,{error:'Serviço já concluído'}); ride.status='cancelled';
    }
    ride.updatedAt=new Date().toISOString(); saveDB(db); return json(res,200,{ride});
  }
  if(req.method==='POST'&&url.pathname==='/api/driver/toggle') {
    if(user.role!=='driver')return json(res,403,{error:'Perfil inválido'});
    if(!user.approved)return json(res,403,{error:'Cadastro aguardando aprovação'});
    if(!user.online && user.dailyFeeDate!==today()) {
      if(user.balance<db.settings.dailyFee)return json(res,409,{error:'Saldo insuficiente para a diária'});
      user.balance=Number((user.balance-db.settings.dailyFee).toFixed(2)); user.dailyFeeDate=today();
      db.transactions.push({id:id('tx'),driverId:user.id,type:'daily_fee',amount:-db.settings.dailyFee,createdAt:new Date().toISOString()});
    }
    user.online=!user.online; saveDB(db); return json(res,200,{user:safeUser(user)});
  }
  if(req.method==='POST'&&url.pathname==='/api/driver/recharge') {
    if(user.role!=='driver')return json(res,403,{error:'Perfil inválido'}); const data=await body(req); const amount=Number(data.amount);
    if(!Number.isFinite(amount)||amount<=0||amount>1000)return json(res,400,{error:'Valor inválido'});
    user.balance=Number((user.balance+amount).toFixed(2)); db.transactions.push({id:id('tx'),driverId:user.id,type:'recharge_demo',amount,createdAt:new Date().toISOString()}); saveDB(db); return json(res,200,{user:safeUser(user)});
  }
  if(req.method==='GET'&&url.pathname==='/api/admin/summary') {
    if(user.role!=='admin')return json(res,403,{error:'Acesso administrativo'});
    const revenue=db.transactions.filter(t=>t.amount<0).reduce((s,t)=>s-t.amount,0);
    return json(res,200,{users:db.users.map(safeUser),rides:db.rides,transactions:db.transactions,summary:{drivers:db.users.filter(u=>u.role==='driver').length,active:db.rides.filter(r=>!['completed','cancelled'].includes(r.status)).length,completed:db.rides.filter(r=>r.status==='completed').length,revenue:Number(revenue.toFixed(2))},settings:db.settings});
  }
  if(req.method==='GET'&&url.pathname==='/api/admin/drivers') {
    if(user.role!=='admin')return json(res,403,{error:'Acesso administrativo'});
    return json(res,200,{drivers:db.users.filter(u=>u.role==='driver').map(u=>({...safeUser(u),documents:(u.documents||[]).map(d=>({kind:d.kind,name:d.name,type:d.type,preview:d.data}))}))});
  }
  const review=url.pathname.match(/^\/api\/admin\/drivers\/([^/]+)\/(approve|reject)$/);
  if(req.method==='POST'&&review) {
    if(user.role!=='admin')return json(res,403,{error:'Acesso administrativo'});const driver=db.users.find(u=>u.id===review[1]&&u.role==='driver');if(!driver)return json(res,404,{error:'Mototaxista não encontrado'});const data=await body(req);
    driver.approved=review[2]==='approve';driver.reviewStatus=driver.approved?'approved':'rejected';driver.reviewNote=String(data.note||'').slice(0,240);driver.reviewedAt=new Date().toISOString();saveDB(db);return json(res,200,{driver:safeUser(driver)});
  }
  return json(res,404,{error:'Rota não encontrada'});
}

const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'};
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost'); if(url.pathname.startsWith('/api/'))return await api(req,res,url);
    let relative=url.pathname==='/'?'index.html':url.pathname.slice(1); const file=path.normalize(path.join(PUBLIC,relative));
    if(!file.startsWith(PUBLIC))return json(res,403,{error:'Negado'});
    fs.readFile(file,(err,data)=>{if(err){fs.readFile(path.join(PUBLIC,'index.html'),(e,d)=>{if(e)return json(res,404,{error:'Não encontrado'});res.writeHead(200,{'Content-Type':mime['.html']});res.end(d);});return;}res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(data);});
  } catch(err) { json(res,err.message==='too_large'?413:400,{error:err.message==='invalid_json'?'JSON inválido':'Não foi possível processar'}); }
});
if(require.main===module)server.listen(PORT,'0.0.0.0',()=>console.log(`Araxá Moto disponível na porta ${PORT}`));
module.exports={server,seed,estimate,calculateRoute};
