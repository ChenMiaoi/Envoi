import {useContext} from 'react';
import {I18nContext} from './context';

export function useT(){
 const ctx=useContext(I18nContext);
 if(!ctx)throw new Error('I18n provider missing');
 return ctx;
}
