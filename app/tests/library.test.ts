import 'fake-indexeddb/auto';import {test} from 'node:test';import assert from 'node:assert/strict';
import {createLibraryStore,filterLibrary,importLibraryFiles,libraryAttachment} from '../src/lib/paperLibrary';
test('personal library imports real PDF bytes and Bib metadata, persists independently and filters',async()=>{
 const name='paperdesk-library-test-'+crypto.randomUUID(),store=createLibraryStore(name);assert.deepEqual(await store.list(),[]);
 const imported=await importLibraryFiles([new File(['%PDF-1.7\nfixture bytes'],'Alpha.pdf'),new File(['@article{beta,title={Beta Study},author={Doe, Jane},year={2024}}'],'metadata.bib')]);assert.equal(imported.length,2);assert.equal(imported[0].author,'');assert.equal(imported[0].title,'Alpha');assert.equal(imported[1].title.toLowerCase(),'beta study');assert.match(imported[1].bib!,/Beta Study/);assert.equal(imported[1].year,'2024');assert.throws(()=>libraryAttachment(imported[1]),/尚未关联/);
 imported[0]={...imported[0],collection:'Methods',tags:['attention'],year:'2025',status:'已读'};await store.put(imported);
 const reopened=await createLibraryStore(name).list();assert.equal(reopened.length,2);const alpha=reopened.find(p=>p.title==='Alpha')!;assert.equal(await libraryAttachment(alpha).text(),'%PDF-1.7\nfixture bytes');assert.equal(filterLibrary(reopened,'alpha attention','Methods','已读','2025').length,1);assert.equal(filterLibrary(reopened,'unmatched','','').length,0);
 await store.put([{...imported[1],attachment:alpha.attachment,attachmentName:'attached.pdf'}]);assert.equal(libraryAttachment((await store.list()).find(p=>p.id===imported[1].id)!).name,'attached.pdf');
 await assert.rejects(importLibraryFiles([new File(['not pdf'],'bad.pdf')]),/不是可识别/);assert.equal((await store.list()).length,2);await store.remove(alpha.id);assert.equal((await store.list()).length,1);
 indexedDB.deleteDatabase(name);
});
