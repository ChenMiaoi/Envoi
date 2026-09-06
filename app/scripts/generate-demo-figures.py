"""Deterministic illustrative model; no measured hardware data."""
from pathlib import Path
import csv
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch
ROOT=Path(__file__).resolve().parents[2]/'examples'/'demo'
OUT=ROOT/'assets'
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':9,'axes.spines.top':False,'axes.spines.right':False,'pdf.fonttype':42})
BLUE='#176b91'; ORANGE='#c46930'
ns=np.array([512,1024,2048,4096,8192,16384,32768])
def model(n,d=64,w=1.2e12,ec=.6):
 f=4*n*n*d; bm=8*n*n+8*n*d; bt=.5*n*n+8*n*d
 c=f/(ec*120e12); m=bm/(.65*w); t=bt/(.65*w)
 return dict(n=int(n),d=d,flops=f,materialized_bytes=bm,tiled_bytes=bt,compute_s=c,materialized_io_s=m,tiled_io_s=t,materialized_s=30e-6+max(c,m),tiled_s=30e-6+max(c,t),materialized_workspace_bytes=4*n*n,tiled_workspace_bytes=4*n*d+8*128*128+16*n)
rows=[model(int(n),d) for d in [64,128,256] for n in ns]
with (ROOT/'data'/'model-data.csv').open('w') as f:
 writer=csv.DictWriter(f,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
def save(name):
 plt.tight_layout();plt.savefig(OUT/(name+'.png'),dpi=300,bbox_inches='tight');
 (ROOT/'.envoi'/'figure-sources').mkdir(parents=True,exist_ok=True);plt.savefig(ROOT/'.envoi'/'figure-sources'/(name+'.pdf'),bbox_inches='tight');plt.close()
def chart(y1,y2,ylabel,name):
 plt.figure(figsize=(3.4,2.5));plt.plot(ns,y1,'o-',color=BLUE,label='Materialized');plt.plot(ns,y2,'s-',color=ORANGE,label='Tiled')
 plt.xscale('log',base=2);plt.yscale('log');plt.xlabel('Sequence length N');plt.ylabel(ylabel);plt.grid(alpha=.2);plt.legend(frameon=False,fontsize=8);save(name)
r=[model(int(n)) for n in ns]
chart([v['materialized_s']*1000 for v in r],[v['tiled_s']*1000 for v in r],'Modeled time (ms)','runtime')
chart([v['materialized_workspace_bytes']/2**20 for v in r],[v['tiled_workspace_bytes']/2**20 for v in r],'Modeled workspace (MiB)','workspace')
fig,ax=plt.subplots(figsize=(7,2.15))
grid=np.array([[model(int(n),d)['materialized_s']/model(int(n),d)['tiled_s'] for n in ns] for d in [64,128,256]])
im=ax.imshow(grid,cmap='Blues',vmin=1,vmax=grid.max(),aspect='auto')
for i in range(3):
 for j in range(7):ax.text(j,i,f'{grid[i,j]:.2f}×',ha='center',va='center',color='white' if grid[i,j]>grid.max()*.65 else '#102a39')
ax.set_xticks(range(7),[str(n) for n in ns]);ax.set_yticks(range(3),['64','128','256']);ax.set_xlabel('Sequence length N');ax.set_ylabel('Head dimension d');fig.colorbar(im,ax=ax,label='Modeled speedup');save('speedup-grid')
for name,values,param,xlabel in [('bandwidth',np.linspace(.3,2.4,30),'w','Assumed bandwidth (TB/s)'),('efficiency',np.linspace(.2,.95,30),'ec','Assumed compute efficiency')]:
 data=[model(8192,**{param:float(x*1e12 if param=='w' else x)}) for x in values]
 plt.figure(figsize=(3.4,2.5));plt.plot(values,[v['materialized_s']*1000 for v in data],color=BLUE,label='Materialized');plt.plot(values,[v['tiled_s']*1000 for v in data],color=ORANGE,label='Tiled');plt.xlabel(xlabel);plt.ylabel('Modeled time (ms)');plt.legend(frameon=False,fontsize=8);plt.grid(alpha=.2);save(name)
fig,ax=plt.subplots(figsize=(7,2.1));ax.set_xlim(0,10);ax.set_ylim(0,3);ax.axis('off')
for y,title,boxes,color in [(2,'Materialized',['Q, K, V','Write scores','Read + softmax','Read + multiply'],BLUE),(.5,'Tiled',['Q, K, V','Local score tile','Update statistics','Accumulate O'],ORANGE)]:
 ax.text(0,y+.7,title,weight='bold',color=color)
 for i,t in enumerate(boxes):
  x=i*2.55;ax.add_patch(FancyBboxPatch((x,y),2.2,.48,boxstyle='round,pad=.05',facecolor=color,alpha=.12,edgecolor=color));ax.text(x+1.1,y+.24,t,ha='center',va='center',fontsize=9)
  if i<3:ax.annotate('',xy=(x+2.5,y+.24),xytext=(x+2.23,y+.24),arrowprops={'arrowstyle':'->','color':color})
save('schedule')
lines=[r'\begin{table}[t]',r'\caption{Deterministic illustrative outputs for $d=64$. Times include the assumed 30~$\mu$s overhead; these are not measurements.}',r'\label{tab:results}',r'\centering',r'\begin{tabular}{rrrr}',r'\toprule',r'$N$ & Materialized (ms) & Tiled (ms) & Ratio \\',r'\midrule']
for v in r:lines.append(f"{v['n']} & {v['materialized_s']*1000:.3f} & {v['tiled_s']*1000:.3f} & {v['materialized_s']/v['tiled_s']:.2f} \\\\")
lines += [r'\bottomrule',r'\end{tabular}',r'\end{table}']
(OUT/'results-table.tex').write_text('\n'.join(lines)+'\n')
print('Generated 6 figures, model-data.csv, results-table.tex')
