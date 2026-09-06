import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),folder=await mkdtemp(path.join(app,'node_modules/.tmp/chat-markdown-'));
try{
 await build({entryPoints:[path.join(app,'src/components/ChatMarkdown.tsx')],outfile:path.join(folder,'view.mjs'),bundle:true,jsx:'automatic',format:'esm',platform:'node',packages:'external',loader:{'.css':'empty'},plugins:[{name:'omit-style-in-node-test',setup(build){build.onResolve({filter:/\.css$/},()=>({path:'style',namespace:'empty'}));build.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:'',loader:'js'}));}}]});
 const {ChatMarkdown}=await import(path.join(folder,'view.mjs'));const render=text=>renderToStaticMarkup(React.createElement(ChatMarkdown,{text}));
 const sample='# 标题\n\n**重点**与*强调*、`x`。\n\n1. 第一项\n2. 第二项\n\n- 无序项\n\n> 引用\n\n[来源](https://example.com)\n\n```js\nconst longLine = "'+ 'x'.repeat(500)+'";\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n公式 $E=mc^2$\n\n$$\n\\int_0^1 x^2 dx\n$$';
 const html=render(sample);for(const element of ['<h1>','<strong>','<em>','<ol>','<ul>','<blockquote>','<pre','<table>','katex'])assert(html.includes(element),element);assert(html.includes('rel="noopener noreferrer"'));assert(html.includes('chat-table-scroll'));
 for(let length=1;length<sample.length;length+=37)assert.doesNotThrow(()=>render(sample.slice(0,length)));
 const unsafe=render('<script>alert(1)</script>\n\n![remote](https://example.com/tracker.png)\n\n[bad](javascript:alert%281%29)\n\n<img src=x onerror=alert(1)>\n\n$\\href{javascript:alert(1)}{bad}$\n\n$\\includegraphics{https://example.com/tracker.png}$');
 assert(!/<script|<img|href="javascript:|onerror=/i.test(unsafe));assert(unsafe.includes('[图片：remote]'));assert.equal(render(sample),html,'history and live text use the same renderer');
 console.log('PASS chat Markdown: headings/lists/emphasis/links/code/GFM table/math, partial streams, safe links/no raw HTML or remote images, deterministic history rendering');
}finally{await rm(folder,{recursive:true,force:true});}
