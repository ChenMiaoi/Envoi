import {createCodingTools} from '@mariozechner/pi-coding-agent';
import {listWorkspaces,createWorkspace,workspaceTarget,saveWorkspaceResult,listWorkspaceResults} from './workspaces.mjs';

// Each chat owns its selection. Changing the visible editor never retargets a tool.
export function researchTools(initialRoot){
 let selected=initialRoot;
 const coding=createCodingTools(initialRoot).map(tool=>({...tool,async execute(...args){
  const target=createCodingTools(selected).find(candidate=>candidate.name===tool.name);
  return target.execute(...args);
 }}));
 const workspaces={name:'research_workspace',label:'研究工作区',description:'List, create or explicitly select an experiment worktree for this AI task. Selection changes subsequent file and shell tools for this task only, not the user editor. Save selected experiment results to the fixed main workspace; code must be committed first. Always report the selected workspace to the user. Never change directories to another workspace implicitly.',
  parameters:{type:'object',properties:{action:{type:'string',enum:['list','create','select','results','save']},target:{type:'string'},name:{type:'string'},purpose:{type:'string'},title:{type:'string'},summary:{type:'string'},command:{type:'string'},files:{type:'array',items:{type:'string'}}},required:['action']},
  async execute(_id,input){
   let result;
   if(input.action==='list')result=await listWorkspaces(initialRoot);
   else if(input.action==='create')result=await createWorkspace(selected,input);
   else if(input.action==='select'){selected=await workspaceTarget(initialRoot,input.target);result={selected,note:'Subsequent tools in this task use this directory. The visible editor is unchanged.'};}
   else if(input.action==='results')result=await listWorkspaceResults(initialRoot);
   else if(input.action==='save')result=await saveWorkspaceResult(initialRoot,{...input,source:selected});
   else throw Error('Unknown workspace action');
   return {content:[{type:'text',text:JSON.stringify({selected,result})}],details:{selected}};
  }};
 return [...coding,workspaces];
}
