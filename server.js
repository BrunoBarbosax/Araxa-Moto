const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DEFAULT_SERVICES, calculatePrice } = require('./pricing');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DB_FILE = process.env.DB_FILE || path.join(ROOT, 'data.json');
const DAILY_FEE = 6;
const COMMISSION = 0.08;

const seed = () => ({
  users: [
    { id:'passenger-demo', role:'passenger', name:'Cliente Demonstração', phone:'34999990001', token:'passageiro-demo' },
    { id:'driver-demo', role:'driver', name:'Carlos Mototáxi', phone:'34999990002', token:'motorista-demo', approved:true, online:false, balance:30, plate:'ABC1D23', rating:4.9, dailyFeeDate:null, employmentPreference:'freelancer', employmentType:'freelancer', monthlySalary:0 },
    { id:'admin-main', role:'admin', name:'Administrador', phone:'', token:crypto.randomBytes(24).toString('hex') }
  ],
  rides: [],
  transactions: [],
  overtimeRecords: [],
  contracts: [], notifications: [], ratings: [], incidents: [], audit: [], journeys: [],
  settings: { dailyFee: DAILY_FEE, commission: COMMISSION, baseFare:5, perKm:2.25, minimumFare:10, additionalStopFee:3, freeWaitMinutes:5, waitPerMinute:.5, nightSurcharge:.2, sundaySurcharge:.15, dispatchRadiusKm:3, dispatchMaxRadiusKm:10, acceptSeconds:20, services:DEFAULT_SERVICES,
    plans:{individual:{name:'Plano mensal individual',price:550,credits:40,authorizedUsers:1},corporate:{name:'Plano empresarial',price:300,credits:20,authorizedUsers:5}} }
});

function loadDB() {
  try { const db=JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));for(const key of ['overtimeRecords','contracts','notifications','ratings','incidents','audit','journeys'])db[key]=db[key]||[];db.settings={...seed().settings,...(db.settings||{}),services:{...DEFAULT_SERVICES,...(db.settings?.services||{})}};const admin=db.users&&db.users.find(u=>u.role==='admin');if(admin&&admin.token==='admin-demo'){admin.token=crypto.randomBytes(24).toString('hex');saveDB(db)};(db.users||[]).forEach(u=>{u.favorites=u.favorites||[];u.emergencyContacts=u.emergencyContacts||[];if(u.role==='driver'){u.employmentPreference=u.employmentPreference||'freelancer';u.employmentType=u.employmentType||(u.approved?'freelancer':null);u.monthlySalary=Number(u.monthlySalary)||0;u.overtimeHourlyRate=Number(u.overtimeHourlyRate)||0}});return db; }
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
function secureEqual(a,b) { const left=crypto.createHash('sha256').update(String(a)).digest();const right=crypto.createHash('sha256').update(String(b)).digest();return crypto.timingSafeEqual(left,right); }
function ageFrom(date) { const born=new Date(`${date}T12:00:00`); if(Number.isNaN(born.getTime()))return 0; const now=new Date();let age=now.getFullYear()-born.getFullYear();if(now.getMonth()<born.getMonth()||(now.getMonth()===born.getMonth()&&now.getDate()<born.getDate()))age--;return age; }
function estimate(settings, km) { return Math.max(settings.minimumFare, settings.baseFare + Number(km||0)*settings.perKm); }
function audit(db,user,action,target,details={}) { db.audit.push({id:id('audit'),userId:user.id,userName:user.name,action,target,details,createdAt:new Date().toISOString()});if(db.audit.length>2000)db.audit=db.audit.slice(-2000); }
function notify(db,userId,title,message,rideId=null) { db.notifications.push({id:id('not'),userId,title,message,rideId,read:false,createdAt:new Date().toISOString()}); }

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
  if(req.method==='POST' && url.pathname==='/api/admin-login') {
    const data=await body(req);const expectedUser=process.env.ADMIN_USERNAME;const expectedPassword=process.env.ADMIN_PASSWORD;
    if(!expectedUser||!expectedPassword)return json(res,503,{error:'Acesso administrativo ainda não configurado no servidor'});
    if(!secureEqual(data.username||'',expectedUser)||!secureEqual(data.password||'',expectedPassword))return json(res,401,{error:'Usuário ou senha administrativa incorretos'});
    const admin=db.users.find(u=>u.role==='admin');if(!admin)return json(res,500,{error:'Administrador não encontrado'});admin.token=crypto.randomBytes(24).toString('hex');saveDB(db);return json(res,200,{token:admin.token,user:safeUser(admin)});
  }
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
    if(role==='driver')Object.assign(user,{approved:false,reviewStatus:'pending',reviewNote:'',online:false,balance:0,rating:5,dailyFeeDate:null,employmentPreference:data.employmentPreference==='employee'?'employee':'freelancer',employmentType:null,monthlySalary:0,birthDate:data.birthDate,cnhNumber:String(data.cnhNumber).slice(0,30),cnhCategory:String(data.cnhCategory).toUpperCase().slice(0,5),cnhExpiry:data.cnhExpiry,plate:String(data.plate).toUpperCase().slice(0,10),motorcycleModel:String(data.motorcycleModel).slice(0,80),motorcycleYear:String(data.motorcycleYear||'').slice(0,4),motorcycleColor:String(data.motorcycleColor||'').slice(0,30),pixKey:String(data.pixKey||'').slice(0,100),documents:data.documents.map(d=>({kind:String(d.kind).slice(0,30),name:String(d.name).slice(0,100),type:String(d.type).slice(0,60),data:String(d.data)}))});
    db.users.push(user);saveDB(db);return json(res,201,{token:user.token,user:safeUser(user)});
  }
  if(req.method==='POST' && url.pathname==='/api/login') {
    const data=await body(req);const phone=normalizePhone(data.phone);const user=db.users.find(u=>normalizePhone(u.phone)===phone&&u.passwordHash);
    if(!user||passwordDigest(data.password||'',user.passwordSalt)!==user.passwordHash)return json(res,401,{error:'Telefone ou senha incorretos'});
    user.token=crypto.randomBytes(24).toString('hex');saveDB(db);return json(res,200,{token:user.token,user:safeUser(user)});
  }
  if(req.method==='POST' && url.pathname==='/api/demo-login') {
    const data=await body(req); const user=db.users.find(u=>u.role===data.role);
    if(data.role==='admin')return json(res,403,{error:'Use o acesso administrativo protegido'});
    return user ? json(res,200,{token:user.token,user:publicUser(user)}) : json(res,404,{error:'Perfil não encontrado'});
  }
  const user=auth(req,db);
  if(!user) return json(res,401,{error:'Sessão inválida'});
  if(req.method==='GET' && url.pathname==='/api/me') return json(res,200,{user:safeUser(user),settings:db.settings,notifications:db.notifications.filter(n=>n.userId===user.id).slice(-30).reverse()});
  if(req.method==='POST' && url.pathname==='/api/route') {
    const data=await body(req);
    if(!data.destination||(!data.origin&&!data.originCoords)) return json(res,400,{error:'Informe origem e destino'});
    try {
      const route=await calculateRoute(String(data.origin||''),String(data.destination),data.originCoords);
      const quote=calculatePrice(db.settings,{...data,distanceKm:route.distanceKm,durationMin:route.durationMin});
      return json(res,200,{route:{...route,price:quote.total,quote}});
    } catch(error) {
      const messages={address_not_found:'Endereço não encontrado em Araxá',route_not_found:'Não foi possível criar uma rota',geocoding_unavailable:'Busca de endereço indisponível',routing_unavailable:'Cálculo de rota indisponível'};
      return json(res,502,{error:messages[error.message]||'Mapa temporariamente indisponível'});
    }
  }
  if(req.method==='GET' && url.pathname==='/api/rides') {
    for(const ride of db.rides)if(ride.status==='scheduled'&&ride.scheduledAt&&new Date(ride.scheduledAt)<=new Date()){ride.status='searching';ride.updatedAt=new Date().toISOString()}
    const rides=user.role==='admin'?db.rides:user.role==='driver'?db.rides.filter(r=>r.driverId===user.id||r.status==='searching'):db.rides.filter(r=>r.passengerId===user.id);
    return json(res,200,{rides:rides.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),settings:db.settings});
  }
  if(req.method==='POST' && url.pathname==='/api/rides') {
    if(user.role!=='passenger'&&user.role!=='admin') return json(res,403,{error:'Apenas clientes ou a central podem solicitar'});
    const data=await body(req); const km=Math.max(.5,Math.min(100,Number(data.distanceKm)||0));
    if(!Number.isFinite(Number(data.distanceKm))||Number(data.distanceKm)<=0) return json(res,400,{error:'Calcule a rota antes de solicitar'});
    if(!data.origin||!data.destination) return json(res,400,{error:'Informe origem e destino'});
    const quote=calculatePrice(db.settings,{...data,distanceKm:km,durationMin:Number(data.durationMin)||1});
    const scheduledAt=data.scheduledAt?new Date(data.scheduledAt).toISOString():null;
    const ride={id:id('corrida'),type:data.serviceType==='delivery'?'delivery':'ride',serviceType:quote.serviceType,serviceName:quote.serviceName,passengerId:user.role==='passenger'?user.id:'passenger-demo',passengerName:user.name,forName:String(data.forName||'').slice(0,100),origin:String(data.origin).slice(0,120),destination:String(data.destination).slice(0,120),stops:Array.isArray(data.stops)?data.stops.slice(0,5).map(x=>String(x).slice(0,120)):[],roundTrip:Boolean(data.roundTrip),scheduledAt,distanceKm:km,durationMin:Math.max(1,Math.min(720,Number(data.durationMin)||1)),routeCoordinates:Array.isArray(data.routeCoordinates)?data.routeCoordinates.slice(0,4000):[],notes:String(data.notes||'').slice(0,500),payment:['cash','pix','contract','corporate'].includes(data.payment)?data.payment:'pix',quote,price:quote.total,status:scheduledAt?'scheduled':'searching',driverId:null,driverName:null,code:String(Math.floor(1000+Math.random()*9000)),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),history:[]};
    db.rides.push(ride);audit(db,user,'ride_created',ride.id,{price:ride.price,serviceType:ride.serviceType});saveDB(db);return json(res,201,{ride});
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
      ride.acceptedAt=new Date().toISOString();notify(db,ride.passengerId,'Corrida aceita',`${user.name} está a caminho.`,ride.id);
    } else if(action==='advance') {
      if(user.role!=='admin'&&ride.driverId!==user.id)return json(res,403,{error:'Sem permissão'});
      const next={accepted:'arriving',arriving:'arrived',arrived:'in_progress',in_progress:'completed'};
      if(!next[ride.status])return json(res,409,{error:'Não é possível avançar este serviço'});
      const data=await body(req);if(ride.status==='arrived'&&user.role!=='admin'&&String(data.code||'')!==String(ride.code))return json(res,409,{error:'Informe o código de segurança do passageiro'});
      ride.status=next[ride.status];
      ride[`${ride.status}At`]=new Date().toISOString();notify(db,ride.passengerId,'Atualização da corrida',`Status: ${ride.status}.`,ride.id);
      if(ride.status==='completed') {
        if(['contract','corporate'].includes(ride.payment)&&ride.serviceType==='urban'&&ride.distanceKm<=7){const contract=db.contracts.find(x=>x.userId===ride.passengerId&&x.status==='active'&&x.remainingCredits>0&&new Date(x.endsAt)>new Date());if(contract){contract.remainingCredits--;ride.contractId=contract.id;ride.price=0;ride.quote={...ride.quote,contractCredit:true,total:0};if(contract.remainingCredits===0)notify(db,ride.passengerId,'Créditos encerrados','Seu plano chegou a zero créditos.',ride.id)}}
        const driver=db.users.find(u=>u.id===ride.driverId);
        if(driver&&driver.employmentType==='freelancer'){const fee=Number((ride.price*db.settings.commission).toFixed(2));const net=Number((ride.price-fee).toFixed(2));driver.balance=Number((driver.balance-fee).toFixed(2));db.transactions.push({id:id('tx'),driverId:driver.id,type:'ride_earning',amount:net,gross:ride.price,fee,rideId:ride.id,createdAt:new Date().toISOString()});db.transactions.push({id:id('tx'),driverId:driver.id,type:'commission',amount:-fee,rideId:ride.id,createdAt:new Date().toISOString()});}
        if(driver&&driver.employmentType==='employee')db.transactions.push({id:id('tx'),driverId:driver.id,type:'employee_ride',amount:0,gross:ride.price,rideId:ride.id,createdAt:new Date().toISOString()});
      }
    } else {
      if(user.role!=='admin'&&ride.passengerId!==user.id&&ride.driverId!==user.id)return json(res,403,{error:'Sem permissão'});
      if(ride.status==='completed')return json(res,409,{error:'Serviço já concluído'});const byDriver=user.role==='driver';ride.cancelFee=byDriver||ride.status==='searching'?0:ride.status==='arrived'?8:5;ride.status='cancelled';ride.cancelledBy=user.role;ride.cancelReason=String((await body(req)).reason||'').slice(0,240);
    }
    ride.history=ride.history||[];ride.history.push({status:ride.status,at:new Date().toISOString(),by:user.id});ride.updatedAt=new Date().toISOString();audit(db,user,`ride_${action}`,ride.id,{status:ride.status});saveDB(db);return json(res,200,{ride});
  }
  if(req.method==='POST'&&url.pathname==='/api/driver/toggle') {
    if(user.role!=='driver')return json(res,403,{error:'Perfil inválido'});
    if(!user.approved)return json(res,403,{error:'Cadastro aguardando aprovação'});
    if(user.employmentType==='freelancer'&&!user.online && user.dailyFeeDate!==today()) {
      if(user.balance<db.settings.dailyFee)return json(res,409,{error:'Saldo insuficiente para a diária'});
      user.balance=Number((user.balance-db.settings.dailyFee).toFixed(2)); user.dailyFeeDate=today();
      db.transactions.push({id:id('tx'),driverId:user.id,type:'daily_fee',amount:-db.settings.dailyFee,createdAt:new Date().toISOString()});
    }
    user.online=!user.online; saveDB(db); return json(res,200,{user:safeUser(user)});
  }
  if(req.method==='POST'&&url.pathname==='/api/driver/recharge') {
    if(user.role!=='driver')return json(res,403,{error:'Perfil inválido'});if(user.employmentType!=='freelancer')return json(res,403,{error:'Contratados não utilizam saldo de diária'}); const data=await body(req); const amount=Number(data.amount);
    if(!Number.isFinite(amount)||amount<=0||amount>1000)return json(res,400,{error:'Valor inválido'});
    user.balance=Number((user.balance+amount).toFixed(2)); db.transactions.push({id:id('tx'),driverId:user.id,type:'recharge_demo',amount,createdAt:new Date().toISOString()}); saveDB(db); return json(res,200,{user:safeUser(user)});
  }
  if(req.method==='POST'&&url.pathname==='/api/driver/overtime/start') {
    if(user.role!=='driver'||user.employmentType!=='employee')return json(res,403,{error:'Hora extra disponível somente para contratados'});
    if(db.overtimeRecords.some(r=>r.driverId===user.id&&r.status==='running'))return json(res,409,{error:'Já existe uma hora extra em andamento'});
    const record={id:id('extra'),driverId:user.id,driverName:user.name,status:'running',startedAt:new Date().toISOString(),endedAt:null,minutes:0,hourlyRate:user.overtimeHourlyRate||0,estimatedValue:0};db.overtimeRecords.push(record);saveDB(db);return json(res,201,{record});
  }
  if(req.method==='POST'&&url.pathname==='/api/driver/overtime/stop') {
    if(user.role!=='driver'||user.employmentType!=='employee')return json(res,403,{error:'Hora extra disponível somente para contratados'});const record=[...db.overtimeRecords].reverse().find(r=>r.driverId===user.id&&r.status==='running');if(!record)return json(res,409,{error:'Nenhuma hora extra em andamento'});
    record.endedAt=new Date().toISOString();record.minutes=Math.max(1,Math.round((new Date(record.endedAt)-new Date(record.startedAt))/60000));record.estimatedValue=Number((record.minutes/60*record.hourlyRate).toFixed(2));record.status='pending';saveDB(db);return json(res,200,{record});
  }
  if(req.method==='GET'&&url.pathname==='/api/driver/finance') {
    if(user.role!=='driver')return json(res,403,{error:'Perfil inválido'});const completed=db.rides.filter(r=>r.driverId===user.id&&r.status==='completed');const gross=completed.reduce((s,r)=>s+Number(r.price||0),0);const commission=user.employmentType==='freelancer'?gross*db.settings.commission:0;
    const overtime=db.overtimeRecords.filter(r=>r.driverId===user.id).slice(-30).reverse();return json(res,200,{employmentType:user.employmentType,monthlySalary:user.monthlySalary||0,overtimeHourlyRate:user.overtimeHourlyRate||0,overtime,balance:user.balance||0,completed:completed.length,gross:Number(gross.toFixed(2)),commission:Number(commission.toFixed(2)),net:Number((gross-commission).toFixed(2)),transactions:db.transactions.filter(t=>t.driverId===user.id).slice(-30).reverse()});
  }
  if(req.method==='POST'&&url.pathname==='/api/profile') {
    const data=await body(req);for(const key of ['cpf','photo','email'])if(data[key]!==undefined)user[key]=String(data[key]).slice(0,500000);if(Array.isArray(data.emergencyContacts))user.emergencyContacts=data.emergencyContacts.slice(0,3).map(x=>({name:String(x.name||'').slice(0,80),phone:normalizePhone(x.phone)}));audit(db,user,'profile_updated',user.id);saveDB(db);return json(res,200,{user:safeUser(user)});
  }
  if(req.method==='POST'&&url.pathname==='/api/favorites') {
    const data=await body(req);if(!data.label||!data.address)return json(res,400,{error:'Informe nome e endereço'});user.favorites=user.favorites||[];user.favorites.push({id:id('fav'),label:String(data.label).slice(0,40),address:String(data.address).slice(0,160)});saveDB(db);return json(res,201,{favorites:user.favorites});
  }
  const favoriteDelete=url.pathname.match(/^\/api\/favorites\/([^/]+)$/);if(req.method==='DELETE'&&favoriteDelete){user.favorites=(user.favorites||[]).filter(x=>x.id!==favoriteDelete[1]);saveDB(db);return json(res,200,{favorites:user.favorites});}
  if(req.method==='POST'&&url.pathname==='/api/notifications/read'){db.notifications.filter(n=>n.userId===user.id).forEach(n=>n.read=true);saveDB(db);return json(res,200,{ok:true});}
  const ratingMatch=url.pathname.match(/^\/api\/rides\/([^/]+)\/rating$/);if(req.method==='POST'&&ratingMatch){const ride=db.rides.find(r=>r.id===ratingMatch[1]);if(!ride||![ride.passengerId,ride.driverId].includes(user.id))return json(res,404,{error:'Corrida não encontrada'});if(ride.status!=='completed')return json(res,409,{error:'Avalie após a conclusão'});const data=await body(req);const score=Math.max(1,Math.min(5,Math.round(Number(data.score)||0)));if(db.ratings.some(x=>x.rideId===ride.id&&x.fromUserId===user.id))return json(res,409,{error:'Avaliação já enviada'});const targetId=user.id===ride.passengerId?ride.driverId:ride.passengerId;db.ratings.push({id:id('rating'),rideId:ride.id,fromUserId:user.id,targetId,score,reason:String(data.reason||'').slice(0,240),createdAt:new Date().toISOString()});const target=db.users.find(x=>x.id===targetId);const scores=db.ratings.filter(x=>x.targetId===targetId);if(target)target.rating=Number((scores.reduce((s,x)=>s+x.score,0)/scores.length).toFixed(1));saveDB(db);return json(res,201,{ok:true});}
  if(req.method==='POST'&&url.pathname==='/api/incidents'){const data=await body(req);const incident={id:id('incident'),userId:user.id,userName:user.name,rideId:String(data.rideId||''),category:String(data.category||'support').slice(0,40),description:String(data.description||'').slice(0,1000),status:'open',createdAt:new Date().toISOString()};db.incidents.push(incident);notify(db,'admin-main','Novo chamado de suporte',`${user.name}: ${incident.category}`,incident.rideId);saveDB(db);return json(res,201,{incident});}
  if(req.method==='POST'&&url.pathname==='/api/driver/location'){if(user.role!=='driver')return json(res,403,{error:'Perfil inválido'});const data=await body(req);user.location={lat:Number(data.lat),lon:Number(data.lon),updatedAt:new Date().toISOString()};saveDB(db);return json(res,200,{ok:true});}
  if(req.method==='POST'&&url.pathname==='/api/driver/journey'){if(user.role!=='driver'||user.employmentType!=='employee')return json(res,403,{error:'Jornada disponível para contratado'});const data=await body(req);const active=[...db.journeys].reverse().find(x=>x.driverId===user.id&&x.status!=='ended');if(data.action==='start'){if(active)return json(res,409,{error:'Jornada já iniciada'});db.journeys.push({id:id('journey'),driverId:user.id,driverName:user.name,status:'working',startedAt:new Date().toISOString(),events:[]});}else{if(!active)return json(res,409,{error:'Nenhuma jornada iniciada'});if(data.action==='break')active.status=active.status==='break'?'working':'break';else if(data.action==='end'){active.status='ended';active.endedAt=new Date().toISOString()}else return json(res,400,{error:'Ação inválida'});active.events.push({action:data.action,at:new Date().toISOString()});}saveDB(db);return json(res,200,{journeys:db.journeys.filter(x=>x.driverId===user.id).slice(-30).reverse()});}
  if(req.method==='GET'&&url.pathname==='/api/contracts'){return json(res,200,{contracts:db.contracts.filter(x=>user.role==='admin'||x.userId===user.id),plans:db.settings.plans});}
  if(req.method==='POST'&&url.pathname==='/api/contracts'){if(user.role!=='passenger')return json(res,403,{error:'Plano disponível para clientes'});const data=await body(req);const plan=db.settings.plans[data.plan];if(!plan)return json(res,400,{error:'Plano inválido'});const contract={id:id('contract'),userId:user.id,userName:user.name,plan:data.plan,name:plan.name,status:'active',price:plan.price,totalCredits:plan.credits,remainingCredits:plan.credits,authorizedUsers:[],autoRenew:Boolean(data.autoRenew),startsAt:new Date().toISOString(),endsAt:new Date(Date.now()+30*864e5).toISOString()};db.contracts.push(contract);audit(db,user,'contract_created',contract.id,{plan:data.plan});saveDB(db);return json(res,201,{contract});}
  if(req.method==='GET'&&url.pathname==='/api/admin/summary') {
    if(user.role!=='admin')return json(res,403,{error:'Acesso administrativo'});
    const revenue=db.transactions.filter(t=>t.amount<0).reduce((s,t)=>s-t.amount,0);
    const drivers=db.users.filter(u=>u.role==='driver');return json(res,200,{users:db.users.map(safeUser),rides:db.rides,transactions:db.transactions,overtimeRecords:db.overtimeRecords,contracts:db.contracts,incidents:db.incidents,audit:db.audit.slice(-100).reverse(),ratings:db.ratings,summary:{drivers:drivers.length,freelancers:drivers.filter(u=>u.employmentType==='freelancer').length,employees:drivers.filter(u=>u.employmentType==='employee').length,overtimePending:db.overtimeRecords.filter(r=>r.status==='pending').length,active:db.rides.filter(r=>!['completed','cancelled'].includes(r.status)).length,completed:db.rides.filter(r=>r.status==='completed').length,revenue:Number(revenue.toFixed(2)),contracts:db.contracts.filter(x=>x.status==='active').length,incidents:db.incidents.filter(x=>x.status==='open').length},settings:db.settings});
  }
  if(req.method==='GET'&&url.pathname==='/api/admin/drivers') {
    if(user.role!=='admin')return json(res,403,{error:'Acesso administrativo'});
    return json(res,200,{drivers:db.users.filter(u=>u.role==='driver').map(u=>({...safeUser(u),documents:(u.documents||[]).map(d=>({kind:d.kind,name:d.name,type:d.type,preview:d.data}))}))});
  }
  const review=url.pathname.match(/^\/api\/admin\/drivers\/([^/]+)\/(approve|reject)$/);
  if(req.method==='POST'&&review) {
    if(user.role!=='admin')return json(res,403,{error:'Acesso administrativo'});const driver=db.users.find(u=>u.id===review[1]&&u.role==='driver');if(!driver)return json(res,404,{error:'Mototaxista não encontrado'});const data=await body(req);
    driver.approved=review[2]==='approve';driver.reviewStatus=driver.approved?'approved':'rejected';driver.reviewNote=String(data.note||'').slice(0,240);driver.reviewedAt=new Date().toISOString();if(driver.approved){driver.employmentType=data.employmentType==='employee'?'employee':'freelancer';driver.monthlySalary=driver.employmentType==='employee'?Math.max(0,Number(data.monthlySalary)||0):0;driver.overtimeHourlyRate=driver.employmentType==='employee'?Math.max(0,Number(data.overtimeHourlyRate)||0):0;driver.dailyFeeDate=null}else{driver.employmentType=null;driver.monthlySalary=0;driver.overtimeHourlyRate=0;driver.online=false}saveDB(db);return json(res,200,{driver:safeUser(driver)});
  }
  const overtimeReview=url.pathname.match(/^\/api\/admin\/overtime\/([^/]+)\/(approve|reject)$/);
  if(req.method==='POST'&&overtimeReview){if(user.role!=='admin')return json(res,403,{error:'Acesso administrativo'});const record=db.overtimeRecords.find(r=>r.id===overtimeReview[1]);if(!record)return json(res,404,{error:'Registro não encontrado'});if(record.status!=='pending')return json(res,409,{error:'Registro já analisado'});record.status=overtimeReview[2]==='approve'?'approved':'rejected';record.reviewedAt=new Date().toISOString();saveDB(db);return json(res,200,{record});}
  if(req.method==='POST'&&url.pathname==='/api/admin/settings'){if(user.role!=='admin')return json(res,403,{error:'Acesso administrativo'});const data=await body(req);for(const key of ['dailyFee','commission','additionalStopFee','freeWaitMinutes','waitPerMinute','nightSurcharge','sundaySurcharge','dispatchRadiusKm','dispatchMaxRadiusKm','acceptSeconds'])if(data[key]!==undefined&&Number.isFinite(Number(data[key])))db.settings[key]=Number(data[key]);if(data.services&&typeof data.services==='object')for(const [key,value] of Object.entries(data.services))if(db.settings.services[key])db.settings.services[key]={...db.settings.services[key],...value};audit(db,user,'settings_updated','settings');saveDB(db);return json(res,200,{settings:db.settings});}
  const incidentReview=url.pathname.match(/^\/api\/admin\/incidents\/([^/]+)\/(resolve|reopen)$/);if(req.method==='POST'&&incidentReview){if(user.role!=='admin')return json(res,403,{error:'Acesso administrativo'});const incident=db.incidents.find(x=>x.id===incidentReview[1]);if(!incident)return json(res,404,{error:'Chamado não encontrado'});incident.status=incidentReview[2]==='resolve'?'resolved':'open';incident.reviewedAt=new Date().toISOString();audit(db,user,'incident_updated',incident.id,{status:incident.status});saveDB(db);return json(res,200,{incident});}
  if(req.method==='DELETE'&&url.pathname==='/api/account'){if(user.role==='admin')return json(res,403,{error:'Conta administrativa não pode ser removida aqui'});user.deletedAt=new Date().toISOString();user.phone=`deleted-${user.id}`;user.token='';user.online=false;audit(db,user,'account_deleted',user.id);saveDB(db);return json(res,200,{ok:true});}
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
module.exports={server,seed,estimate,calculateRoute,calculatePrice};
