import { execFileSync } from 'node:child_process';
import { build, transform } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { posix } from 'node:path';
import vm from 'node:vm';

const cases = [
  ['ec75f59', 'tests/design.spec.ts', 'sample()'],
  ['bcda6b5', 'tests/image-data.spec.ts', "({...emptyDesign('youtube', null), decorations:[image()]})"],
  ['082c59c', 'tests/image-data.spec.ts', "({...emptyDesign('youtube', null), decorations:[{...image(), locked:true}]})"],
  ['68290f4', 'tests/motion-data.spec.ts', "({...emptyDesign('youtube', 'retro'), decorations:[layer()]})"],
  ['e2fb4b8', 'tests/effect-data.spec.ts', "(()=>{const mask=defaultCircleMask(); mask.bindings.unshift({source:'video.playing',transform:{kind:'boolean-gate',fadeMs:400},target:'mask.intensity'}); return {...document(),decorations:[{...image(),effects:[mask]}]};})()"],
  ['1d23ec0', 'tests/group-data.spec.ts', '({...document(),groups:[group()]})'],
];
const output = 'tests/fixtures/designs';
await mkdir(output, { recursive:true });
const provenance=[];
for (const [i, [ref, file, expression]] of cases.entries()) {
  const read = file => execFileSync('git', ['show', `${ref}:${file}`], {encoding:'utf8'});
  const result = await build({ stdin:{contents:`export * from './src/design/schema';${i>=4?"export * from './src/effects/types';":''}`,resolveDir:process.cwd()},bundle:true,write:false,format:'cjs',platform:'node',plugins:[{
    name:'historical-source',setup(build){
      build.onResolve({filter:/^\./},args=>({path:posix.normalize(posix.join(args.namespace==='historical'?posix.dirname(args.importer):'',args.path))+'.ts',namespace:'historical'}));
      build.onLoad({filter:/.*/,namespace:'historical'},args=>({contents:read(args.path),loader:'ts'}));
    }
  }],logLevel:'silent'});
  const context={module:{exports:{}},Buffer}; vm.createContext(context);
  vm.runInContext(`(function(){${result.outputFiles[0].text}\n})()`,context);
  Object.assign(context,context.module.exports);
  const prefix=read(file).split(/\btest\(/)[0].replace(/^import .*;\r?\n/gm,'');
  vm.runInContext((await transform(prefix+`\nglobalThis.fixture = ${expression};`,{loader:'ts'})).code,context);
  const raw=JSON.parse(JSON.stringify(context.fixture));
  const parsed=context.parseDesign(raw);
  if(raw.schemaVersion!==i+1 || parsed.schemaVersion!==i+1) throw new Error('Historical version mismatch');
  const sha=execFileSync('git',['rev-parse',ref],{encoding:'utf8'}).trim();
  await writeFile(`${output}/v${i+1}.json`,JSON.stringify(raw,null,2)+'\n');
  provenance.push({version:i+1,commit:sha,file,expression});
}
await writeFile(`${output}/provenance.json`,JSON.stringify(provenance,null,2)+'\n');
console.log('Six historical test fixtures accepted by their original parsers.');
