const test=require('node:test');const assert=require('node:assert/strict');const {seed,estimate,calculateRoute,calculatePrice}=require('./server');
test('preço respeita tarifa mínima',()=>{const s=seed().settings;assert.equal(estimate(s,1),10)});
test('preço soma base e distância',()=>{const s=seed().settings;assert.equal(estimate(s,10),27.5)});
test('modelo financeiro está configurado',()=>{const s=seed().settings;assert.equal(s.dailyFee,6);assert.equal(s.commission,.08)});
test('mototaxista demonstrativo começa como freelancer',()=>{const d=seed().users.find(u=>u.role==='driver');assert.equal(d.employmentType,'freelancer');assert.equal(d.monthlySalary,0)});
test('banco inicia com controle de horas extras',()=>{assert.deepEqual(seed().overtimeRecords,[])});
test('urbano cobra somente os quilômetros acima de 7 km',()=>{const q=calculatePrice(seed().settings,{serviceType:'urban',distanceKm:10,durationMin:20,when:'2026-09-21T12:00:00'});assert.equal(q.total,27);assert.equal(q.distance,12)});
test('rural usa deslocamento mais a rota real',()=>{const q=calculatePrice(seed().settings,{serviceType:'rural',distanceKm:10,durationMin:20,when:'2026-09-21T12:00:00'});assert.equal(q.total,60)});
test('rodovia usa três reais por quilômetro',()=>{const q=calculatePrice(seed().settings,{serviceType:'highway',distanceKm:10,durationMin:20,when:'2026-09-21T12:00:00'});assert.equal(q.total,50)});
test('adicionais noturno e domingo não acumulam',()=>{const q=calculatePrice(seed().settings,{serviceType:'urban',distanceKm:7,durationMin:20,when:'2026-09-20T23:00:00'});assert.equal(q.surchargeRate,.2);assert.equal(q.total,18)});
test('espera tem cinco minutos de tolerância',()=>{const q=calculatePrice(seed().settings,{serviceType:'urban',distanceKm:7,durationMin:20,waitMinutes:9,when:'2026-09-21T12:00:00'});assert.equal(q.waiting,2);assert.equal(q.total,17)});
test('rota transforma metros em distância e tempo automáticos',async()=>{
  const original=global.fetch;
  global.fetch=async url=>url.toString().includes('nominatim')
    ? {ok:true,json:async()=>[{lat:'-19.5937',lon:'-46.9401',display_name:'Araxá'}]}
    : {ok:true,json:async()=>({routes:[{distance:4250,duration:720,geometry:{coordinates:[[-46.94,-19.59],[-46.91,-19.61]]}}]})};
  try {
    const route=await calculateRoute('Centro','Barreiro');
    assert.equal(route.distanceKm,4.25);assert.equal(route.durationMin,12);assert.deepEqual(route.coordinates[0],[-19.59,-46.94]);
  } finally { global.fetch=original; }
});
