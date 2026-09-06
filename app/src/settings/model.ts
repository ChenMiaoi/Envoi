import {migrateLegacyBindings,normalizeBindings} from "../navigation/shortcuts";
export type Engine='pdflatex'|'xelatex';
export type TextFont='system'|'sans'|'serif';
export interface Preferences {version:1;bindings:string[];uiFontFamily:TextFont;uiFontSize:number;previewFontFamily:TextFont;previewFontSize:number;theme:ThemeId;accent:'lemon'|'blue'|'green'|'rose';fontSize:number;fontFamily:'system'|'menlo'|'monaco';lineHeight:number;tabSize:number;disabledRules:number[];engine:Engine;lintEnabled:boolean;defaultGit:boolean}
export interface ProjectConfiguration {version:1;overrides:{engine?:Engine;lintEnabled?:boolean;disabledRules?:number[]}}
export const defaults:Preferences={version:1,bindings:[],uiFontFamily:'system',uiFontSize:13,previewFontFamily:'system',previewFontSize:14,theme:'graphite',accent:'lemon',fontSize:12.5,fontFamily:'system',lineHeight:1.75,tabSize:4,disabledRules:[],engine:'pdflatex',lintEnabled:true,defaultGit:true};
/** 主题完整色板定义在 index.css 的 [data-theme] 块中；这里只保存元数据与设置页预览色。 */
export type ThemeId='graphite'|'classic'|'midnight'|'forest'|'paper'|'mist';
export const themes:Record<ThemeId,{name:string;mode:'dark'|'light';swatch:{bg:string;panel:string}}>={
 graphite:{name:'石墨',mode:'dark',swatch:{bg:'#23272e',panel:'#2d333c'}},
 classic:{name:'经典夜色',mode:'dark',swatch:{bg:'#18181b',panel:'#252526'}},
 midnight:{name:'午夜蓝',mode:'dark',swatch:{bg:'#1a1e28',panel:'#262c3a'}},
 forest:{name:'松林',mode:'dark',swatch:{bg:'#1e231f',panel:'#293029'}},
 paper:{name:'纸墨',mode:'light',swatch:{bg:'#f7f5f1',panel:'#ece9e3'}},
 mist:{name:'雾白',mode:'light',swatch:{bg:'#f2f4f7',panel:'#e6e9ee'}}};
/** hsl 用于深色主题；浅色主题下改用 light 变体保证对比度。 */
export const accents={lemon:{name:'柠檬',hsl:'57 62% 83%',light:'46 72.4% 28.4%'},blue:{name:'雾蓝',hsl:'208 58% 71%',light:'215 56.3% 42.2%'},green:{name:'薄荷',hsl:'120 34% 72%',light:'127 33.3% 35.9%'},rose:{name:'玫瑰',hsl:'338 51% 75%',light:'335 48.7% 44.3%'}};
export const editorFonts={system:{name:'系统等宽',css:'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'},menlo:{name:'Menlo',css:'Menlo, ui-monospace, monospace'},monaco:{name:'Monaco',css:'Monaco, ui-monospace, monospace'}};
export const textFonts={system:{name:'系统字体',css:'-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'},sans:{name:'无衬线 · Arial',css:'Arial, "PingFang SC", "Microsoft YaHei", sans-serif'},serif:{name:'衬线 · Georgia',css:'Georgia, "Songti SC", "SimSun", serif'}};
export function normalizeRules(raw:unknown){return Array.isArray(raw)?[...new Set(raw.filter(n=>Number.isInteger(n)&&n>=1&&n<=42))].sort((a,b)=>a-b):[];}
export function normalizePreferences(raw:unknown):Preferences{
 const value=raw&&typeof raw==='object'?raw as Partial<Preferences>:{};
 const legacy='shortcuts' in value?value.shortcuts:undefined;
 return {version:1,bindings:normalizeBindings(Array.isArray(value.bindings)?value.bindings:migrateLegacyBindings(legacy)),uiFontFamily:value.uiFontFamily&&value.uiFontFamily in textFonts?value.uiFontFamily:'system',uiFontSize:[12,13,14,15,16].includes(value.uiFontSize??0)?value.uiFontSize!:13,previewFontFamily:value.previewFontFamily&&value.previewFontFamily in textFonts?value.previewFontFamily:'system',previewFontSize:[12,14,16,18,20].includes(value.previewFontSize??0)?value.previewFontSize!:14,theme:value.theme&&value.theme in themes?value.theme:defaults.theme,accent:value.accent&&value.accent in accents?value.accent:defaults.accent,fontSize:typeof value.fontSize==='number'&&[11,12.5,14,16,18].includes(value.fontSize)?value.fontSize:defaults.fontSize,fontFamily:value.fontFamily&&value.fontFamily in editorFonts?value.fontFamily:'system',lineHeight:[1.5,1.75,2].includes(value.lineHeight??0)?value.lineHeight!:1.75,tabSize:[2,4,8].includes(value.tabSize??0)?value.tabSize!:4,disabledRules:normalizeRules(value.disabledRules),engine:value.engine==='xelatex'?'xelatex':'pdflatex',lintEnabled:typeof value.lintEnabled==='boolean'?value.lintEnabled:defaults.lintEnabled,defaultGit:typeof value.defaultGit==='boolean'?value.defaultGit:defaults.defaultGit};
}
export function projectConfiguration(raw:unknown,legacyEngine?:string):ProjectConfiguration{
 const value=raw&&typeof raw==='object'?raw as {version?:number;overrides?:ProjectConfiguration['overrides']}:undefined;
 const candidate=value?.version===1?value.overrides??{}:{engine:legacyEngine};const overrides:ProjectConfiguration['overrides']={};
 if(candidate.engine==='pdflatex'||candidate.engine==='xelatex')overrides.engine=candidate.engine;
 if('lintEnabled' in candidate&&typeof candidate.lintEnabled==='boolean')overrides.lintEnabled=candidate.lintEnabled;
 if('disabledRules' in candidate&&Array.isArray(candidate.disabledRules))overrides.disabledRules=normalizeRules(candidate.disabledRules);
 return {version:1,overrides};
}
export function effectivePreferences(global:Preferences,project:ProjectConfiguration){return {...global,...project.overrides};}
export const settingCategories={general:'通用',editor:'编辑器',compile:'编译',references:'文献与版本管理',ai:'AI 服务'};
export type SettingsCategory=keyof typeof settingCategories;
export type SettingsScope='global'|'project';
