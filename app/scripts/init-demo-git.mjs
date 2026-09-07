import {fileURLToPath} from 'node:url';
import {createExampleProject} from '../electron/main/example-project.mjs';
import {dataDir} from '../server/local-data.mjs';

// Compatibility command: create the same independent demo used by the desktop.
const source=fileURLToPath(new URL('../../examples/demo/',import.meta.url));
console.log(await createExampleProject({source,dataDirectory:dataDir}));
