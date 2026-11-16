const test=require('node:test'),assert=require('node:assert/strict');
const {createReceiptSink}=require('./webhook-receipts.cjs');
test('receipt sink allowlists metadata and removes secrets/customer bodies',()=>{
 let output='';const io={existsSync:()=>false,appendFileSync:(_f,s,opts)=>{output+=s;assert.equal(opts.mode,0o600);}};
 const sink=createReceiptSink('ignored',{io});
 assert.equal(sink.write({eventId:'evt_test',status:200,body:'private',customer:'private',signature:'whsec_private',failure:'sk_test_private',correlationId:'request-1'}),true);
 assert.deepEqual(JSON.parse(output),{eventId:'evt_test',status:200,correlationId:'request-1'});
});
test('receipt persistence errors and size exhaustion are explicit and bounded',()=>{
 let failure=0;const sink=createReceiptSink('ignored',{maxBytes:2,io:{existsSync:()=>false},onFailure:()=>failure++});
 assert.equal(sink.write({eventId:'evt_test'}),false);assert.equal(sink.failed,true);assert.equal(failure,1);
 const broken=createReceiptSink('ignored',{io:{existsSync:()=>false,appendFileSync:()=>{throw Error('disk');}}});
 assert.equal(broken.write({status:200}),false);assert.equal(broken.failed,true);
});
