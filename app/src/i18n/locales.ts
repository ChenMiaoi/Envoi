/** 语言注册表：i18n 的单一事实来源。注意：本模块不得反向依赖 settings/model，避免循环。 */
export type LocaleId='zh-CN'|'en'|'ja'|'zh-TW'|'zh-HK';
export interface LocaleMeta{id:LocaleId;native:string;htmlLang:string}
export const locales:LocaleMeta[]=[
 {id:'zh-CN',native:'简体中文',htmlLang:'zh-CN'},
 {id:'en',native:'English',htmlLang:'en'},
 {id:'ja',native:'日本語',htmlLang:'ja'},
 {id:'zh-TW',native:'繁體中文（臺灣）',htmlLang:'zh-TW'},
 {id:'zh-HK',native:'繁體中文（香港）',htmlLang:'zh-HK'},
];
export function isLocaleId(value:unknown):value is LocaleId{return typeof value==='string'&&locales.some(locale=>locale.id===value);}
export function localeMeta(id:LocaleId){return locales.find(locale=>locale.id===id)??locales[0];}