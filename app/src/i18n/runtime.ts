import type {LocaleId} from './locales';
import {zhCN,type Messages} from './messages/zh-CN';
export type {MessageKey} from './messages/zh-CN';
import type {MessageKey} from './messages/zh-CN';
import en from './messages/en';
import ja from './messages/ja';
import zhTW from './messages/zh-TW';
import zhHK from './messages/zh-HK';

export const dictionaries:Record<LocaleId,Messages>={'zh-CN':zhCN,en,ja,'zh-TW':zhTW,'zh-HK':zhHK};

export function formatMessage(template:string,vars?:Record<string,string|number>){
 if(!vars)return template;
 return template.replace(/\{(\w+)\}/g,(match,name)=>(name in vars?String(vars[name]):match));
}

let currentLocale:LocaleId='zh-CN';
export function setCurrentLocale(locale:LocaleId){currentLocale=locale;}

/** 非 React 代码（lib、toast 文案）用的模块级翻译；语言由 I18nProvider 同步。 */
export function translate(key:MessageKey,vars?:Record<string,string|number>){
 const dict=dictionaries[currentLocale]??zhCN;
 return formatMessage(dict[key]??zhCN[key],vars);
}
