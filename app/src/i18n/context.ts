import {createContext} from 'react';
import type {LocaleId} from './locales';
import type {MessageKey} from './messages/zh-CN';

export interface I18nValue{locale:LocaleId;t:(key:MessageKey,vars?:Record<string,string|number>)=>string}
export const I18nContext=createContext<I18nValue|null>(null);
