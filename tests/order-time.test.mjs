import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8'),c={};vm.createContext(c);
for(const name of ['orderDate','orderTimeText'])vm.runInContext(source.split('\n').find(x=>x.startsWith('function '+name+'(')),c);
test('SQLite UTC order time displays correct IST wall clock',()=>{assert.equal(c.orderDate('2026-09-06 10:15:00').toISOString(),'2026-09-06T10:15:00.000Z');assert.match(c.orderTimeText('2026-09-06 10:15:00'),/03:45:00 pm IST/i)});
test('ISO UTC and explicit Indian offset are not converted twice',()=>{assert.equal(c.orderTimeText('2026-09-06T10:15:00Z'),c.orderTimeText('2026-09-06T15:45:00+05:30'));assert.equal(c.orderTimeText('2026-09-06 10:15:00'),c.orderTimeText('2026-09-06T10:15:00Z'))});
test('IST midnight advances the order date correctly',()=>{assert.match(c.orderTimeText('2026-09-06 20:00:00'),/07 Sept 2026/);assert.match(c.orderTimeText('2026-09-06 20:00:00'),/01:30:00 am IST/i)});
test('missing and invalid dates show a dash',()=>{assert.equal(c.orderTimeText(null),'—');assert.equal(c.orderTimeText('invalid'),'—')});
test('order lists consistently use formatter',()=>{for(const line of source.split('\n').filter(x=>x.includes('Ordered:')))assert(!line.includes("new Date(x.created_at||'').toLocaleString"));});
