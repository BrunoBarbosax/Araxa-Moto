'use strict';

const round = value => Number((Number(value) || 0).toFixed(2));

const DEFAULT_SERVICES = {
  urban: { name:'Mototáxi urbano', base:15, includedKm:7, extraKm:4 },
  rural: { name:'Mototáxi rural', base:20, includedKm:0, extraKm:4 },
  highway: { name:'Rodovia', base:20, includedKm:0, extraKm:3 },
  intercity: { name:'Viagem intermunicipal', base:260, includedKm:0, extraKm:3, includedMinutes:480, extraMinute:50/60 },
  errands: { name:'Serviços e documentos', base:30, includedKm:10, extraKm:4, includedMinutes:60, extraMinute:1, includedStops:2 },
  hourlyUrban: { name:'Piloto à disposição — urbano', base:40, includedKm:15, extraKm:4, includedMinutes:60, extraMinute:1 },
  hourlyRural: { name:'Piloto à disposição — rural', base:60, includedKm:15, extraKm:4, includedMinutes:60, extraMinute:1 },
  delivery: { name:'Entrega expressa', base:15, includedKm:7, extraKm:4 }
};

function calculatePrice(settings, input={}) {
  const services = {...DEFAULT_SERVICES, ...(settings.services || {})};
  const key = services[input.serviceType] ? input.serviceType : 'urban';
  const service = services[key];
  const km = Math.max(0, Number(input.distanceKm) || 0);
  const minutes = Math.max(0, Number(input.durationMin) || 0);
  const stops = Math.max(0, Math.floor(Number(input.additionalStops) || 0));
  const waitMinutes = Math.max(0, Number(input.waitMinutes) || 0);
  const tolls = Math.max(0, Number(input.tolls) || 0);
  const parking = Math.max(0, Number(input.parking) || 0);
  const distance = round(Math.max(0, km - (service.includedKm || 0)) * (service.extraKm || 0));
  const time = round(Math.max(0, minutes - (service.includedMinutes || Number.POSITIVE_INFINITY)) * (service.extraMinute || 0));
  const stopFee = round(stops * Number(settings.additionalStopFee ?? 3));
  const waiting = round(Math.max(0, waitMinutes - Number(settings.freeWaitMinutes ?? 5)) * Number(settings.waitPerMinute ?? .5));
  const subtotal = round(service.base + distance + time + stopFee + waiting + tolls + parking);
  const date = input.when ? new Date(input.when) : new Date();
  const hour = date.getHours();
  const night = hour >= 22 || hour < 6;
  const sunday = date.getDay() === 0 || Boolean(input.holiday);
  const surchargeRate = Math.max(night ? Number(settings.nightSurcharge ?? .2) : 0, sunday ? Number(settings.sundaySurcharge ?? .15) : 0);
  const surcharge = round(subtotal * surchargeRate);
  const total = round(subtotal + surcharge);
  return { serviceType:key, serviceName:service.name, distanceKm:round(km), durationMin:Math.round(minutes), base:round(service.base), distance, time, stops:stopFee, waiting, tolls:round(tolls), parking:round(parking), surcharge, surchargeRate, total };
}

module.exports = { DEFAULT_SERVICES, calculatePrice };
