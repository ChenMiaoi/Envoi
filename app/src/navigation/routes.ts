import {settingCategories} from "../settings/model";
export type ViewId='reader'|'writer'|'library'|'history'|'settings';
export const viewPaths:Record<ViewId,string>={reader:'/reader',writer:'/writer',library:'/library',history:'/history',settings:'/settings'};
export const viewNames:Record<ViewId,string>={reader:'阅读配置',writer:'写作配置',library:'论文库',history:'版本历史',settings:'设置'};
export function resolvePage(pathname:string):{view?:ViewId;redirect?:string}{
 if(pathname==='/')return {redirect:viewPaths.reader};
 const normalized=pathname.replace(/\/+$/,'');
 if(normalized==='/settings')return {view:'settings',redirect:'/settings/global/general'};
 const settings=/^\/settings\/(global|project)(?:\/([^/]+))?$/.exec(normalized);
 if(settings){if(!settings[2])return {view:'settings',redirect:`/settings/${settings[1]}/general`};if(settings[2] in settingCategories||(settings[1]==='global'&&settings[2]==='shortcuts'))return {view:'settings',...(normalized!==pathname?{redirect:normalized}:{})};return {};}
 const view=(Object.keys(viewPaths) as ViewId[]).find(id=>viewPaths[id]===normalized);
 return view?{view,...(normalized!==pathname?{redirect:normalized}:{})}:{};
}
