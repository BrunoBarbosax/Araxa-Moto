const test=require('node:test');const assert=require('node:assert/strict');const {seed,estimate,calculateRoute}=require('./server');
test('preço respeita tarifa mínima',()=>{const s=seed().settings;assert.equal(estimate(s,1),10)});
test('preço soma base e distância',()=>{const s=seed().settings;assert.equal(estimate(s,10),27.5)});
test('modelo financeiro está configurado',()=>{const s=seed().settings;assert.equal(s.dailyFee,6);assert.equal(s.commission,.08)});
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
