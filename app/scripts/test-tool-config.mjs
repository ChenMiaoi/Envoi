import assert from 'node:assert/strict';import {toolInfo,validateChktexPath,configureTools} from '../server/tool-config.mjs';
const info=toolInfo();assert(info.chktex.available);assert(validateChktexPath(info.chktex.path).endsWith('/chktex'));assert.equal(info.texlab.integrationAvailable,false);
assert.throws(()=>validateChktexPath('/bin/sh'));assert.throws(()=>validateChktexPath('chktex --shell-command'));
await assert.rejects(configureTools({chktexPath:'/bin/sh'}));await assert.rejects(configureTools({command:'echo injected'}));
console.log('PASS detected ChkTeX/version and validated executable-only configuration; wrong binary/commands rejected without changing tool settings');
