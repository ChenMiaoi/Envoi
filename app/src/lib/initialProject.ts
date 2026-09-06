import type {PaperProject} from './projectFiles';
export function emptyProject():PaperProject{return {id:'empty',name:'未打开项目',files:[],directories:[],rootId:''};}
export function initialProject(cached?:PaperProject){return cached&&!(cached.id==='demo'&&!cached.directory)?cached:emptyProject();}
