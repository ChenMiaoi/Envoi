import {build} from 'esbuild';import assert from 'node:assert/strict';
await build({entryPoints:['src/lib/gitGraph.ts'],bundle:true,platform:'node',format:'esm',outfile:'tmp/compile-check/gitGraph.mjs'});
const {layoutGraph}=await import('../tmp/compile-check/gitGraph.mjs');
const mk=(hash,parents=[],extra={})=>({hash,parents,refs:[],head:false,author:'A',date:'2026-01-01T00:00:00Z',subject:hash,...extra});
// main: a ← c ← M(merge), feature: a ← b; topo order M,c,b,a
const {rows,edges,laneCount}=layoutGraph([mk('M',['c','b']),mk('c',['a']),mk('b',['a']),mk('a')]);
assert.deepEqual(rows.map(r=>[r.commit.hash,r.lane]),[['M',0],['c',0],['b',1],['a',0]]);
const edge=(from,to)=>edges.find(e=>rows[e.fromRow].commit.hash===from&&rows[e.toRow]?.commit.hash===to);
assert(edge('M','c').fromLane===0&&edge('M','c').toLane===0);
assert(edge('M','b').toLane===1);
assert(edge('c','a').toLane===0&&edge('b','a').fromLane===1&&edge('b','a').toLane===0);
assert.equal(laneCount,2);
// Second child of the same parent gets its own lane; parent lane already reserved
const fork=layoutGraph([mk('x',['a']),mk('y',['a']),mk('a')]);
assert.deepEqual(fork.rows.map(r=>r.lane),[0,1,0]);
// Parent cut off by max-count still gets an edge leaving the bottom of the graph
const cut=layoutGraph([mk('x',['a'])]);
assert.equal(cut.edges[0].toRow,1);assert.equal(cut.edges.length,1);
console.log('PASS git graph layout: merge lanes, shared parent, cutoff edge');
