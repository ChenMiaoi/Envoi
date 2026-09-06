import {createContext,useContext} from 'react';import type {Preferences} from './model';
export const PreferencesContext=createContext<{preferences:Preferences;update:(patch:Partial<Preferences>)=>void;error:string}|null>(null);
export function usePreferences(){const value=useContext(PreferencesContext);if(!value)throw Error('Preferences provider missing');return value;}
