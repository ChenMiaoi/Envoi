import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createWorkspaceTrust} from '../electron/main/workspace-trust.mjs';
test('trust persists, coalesces prompts, covers descendants and canonical aliases only',async()=>{
 const temp=await mkdtemp(path.join(tmpdir(),'envoi-trust-'));
 try{
 const root=path.join(temp,'paper'),child=path.join(root,'chapter'),sibling=path.join(temp,'paper-other'),alias=path.join(temp,'alias');
 await mkdir(child,{recursive:true});await mkdir(sibling);await symlink(root,alias,process.platform==='win32'?'junction':'dir');
 let prompts=0;const file=path.join(temp,'trust.json');const trust=createWorkspaceTrust(file,async()=>{prompts++;return true;});
 await assert.rejects(trust.requireTrust(root));
 await Promise.all([trust.trust(root),trust.trust(root),trust.trust(alias)]);assert.equal(prompts,1);
 await trust.requireTrust(child);await assert.rejects(trust.requireTrust(sibling));
 const reopened=createWorkspaceTrust(file,async()=>assert.fail('must not prompt after restart'));
 await reopened.trust(alias);await reopened.trust(child);
 const denied=createWorkspaceTrust(file,async()=>false);await assert.rejects(denied.trust(sibling));await assert.rejects(denied.requireTrust(sibling));
 }finally{await rm(temp,{recursive:true,force:true});}
});
