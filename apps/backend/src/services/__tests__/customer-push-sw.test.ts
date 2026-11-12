import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
const script=readFileSync(resolve('../frontend/public/delivery-push-sw.js'),'utf8');
const payload={v:1,bindingId:'11111111-1111-4111-8111-111111111111',eventId:'22222222-2222-4222-8222-222222222222'};
function fixture(status=200,url='/orders/ORD-33333333-3333-4333-8333-333333333333') {
 const listeners:Record<string,(event:unknown)=>void>={};const showNotification=vi.fn();const openWindow=vi.fn();
 const fetch=vi.fn().mockResolvedValue({ok:status===200,status,json:async()=>({data:{url}})});
 const self={location:{origin:'https://store.example.invalid'},registration:{showNotification,getNotifications:async()=>[]},clients:{claim:async()=>{},matchAll:async()=>[],openWindow},addEventListener:(name:string,fn:(event:unknown)=>void)=>{listeners[name]=fn;}};
 runInNewContext(script,{self,fetch,URL,console});
 const dispatch=async(name:string,data:unknown)=>{let work=Promise.resolve();listeners[name]!({data:{json:()=>data},notification:{data,close:vi.fn()},waitUntil:(p:Promise<void>)=>{work=p;}});await work;};
 return {fetch,showNotification,openWindow,dispatch};
}
describe('actual delivery service worker source (VM; no OS presentation claim)',()=>{
 it('retains only a trusted order destination for a logged-out click, never a foreign account',async()=>{
  const data={...payload,url:'https://store.example.invalid/orders/ORD-33333333-3333-4333-8333-333333333333'};
  const loggedOut=fixture(401);await loggedOut.dispatch('notificationclick',data);expect(loggedOut.openWindow).toHaveBeenCalledWith(data.url);
  const foreign=fixture(404);await foreign.dispatch('notificationclick',data);expect(foreign.openWindow).not.toHaveBeenCalled();
  const unsafe=fixture(401);await unsafe.dispatch('notificationclick',{...data,url:'https://evil.invalid/orders/ORD-33333333-3333-4333-8333-333333333333'});expect(unsafe.openWindow).not.toHaveBeenCalled();
 });
 it('handles push independently of React, authorizes current cookie and uses a stable duplicate tag',async()=>{
  const f=fixture();await f.dispatch('push',payload);await f.dispatch('push',payload);
  expect(f.fetch).toHaveBeenCalledWith('/api/auth/customer/push/receipt',expect.objectContaining({credentials:'same-origin',method:'POST'}));
  expect(f.showNotification).toHaveBeenCalledWith('ElectroHub — Order Out for Delivery',expect.objectContaining({tag:'electrohub-delivery-'+payload.eventId,renotify:false}));
  await f.dispatch('notificationclick',payload);expect(f.openWindow).toHaveBeenCalledWith('https://store.example.invalid/orders/ORD-33333333-3333-4333-8333-333333333333');
 });
 it('suppresses logged-out/foreign-session/offline/malformed pushes and unsafe URLs',async()=>{
  for(const status of [401,404]){const f=fixture(status);await f.dispatch('push',payload);await f.dispatch('notificationclick',payload);expect(f.showNotification).not.toHaveBeenCalled();expect(f.openWindow).not.toHaveBeenCalled();}
  const offline=fixture();offline.fetch.mockRejectedValue(new Error('offline'));await offline.dispatch('push',payload);expect(offline.showNotification).not.toHaveBeenCalled();
  const invalid=fixture();await invalid.dispatch('push',{...payload,v:2});expect(invalid.fetch).not.toHaveBeenCalled();
  const unsafe=fixture(200,'https://evil.invalid');await unsafe.dispatch('push',payload);expect(unsafe.showNotification).not.toHaveBeenCalled();
 });
});
