import { readFile, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = 'tests/fixtures/motion';
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const table = Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++) n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const chunk = (type, data) => { const b=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;for(const v of b) crc=table[(crc^v)&255]^(crc>>>8);return Buffer.concat([u32(data.length),b,u32((crc^0xffffffff)>>>0)]); };
const width=64,height=48;
const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
const chunks=[Buffer.from('\x89PNG\r\n\x1a\n','binary'),chunk('IHDR',header),chunk('acTL',Buffer.concat([u32(3),u32(0)]))];
let sequence=0;
for(let frame=0;frame<3;frame++) {
  const control=Buffer.alloc(26);control.writeUInt32BE(sequence++);control.writeUInt32BE(width,4);control.writeUInt32BE(height,8);control.writeUInt16BE(12,20);control.writeUInt16BE(100,22);
  chunks.push(chunk('fcTL',control));
  const pixels=Buffer.alloc(height*(width*4+1));
  for(let y=8;y<40;y++)for(let x=8+frame*4;x<36+frame*4;x++) {const p=y*(width*4+1)+1+x*4;pixels[p+frame]=240;pixels[p+3]=180;}
  const packed=deflateSync(pixels);
  chunks.push(frame===0?chunk('IDAT',packed):chunk('fdAT',Buffer.concat([u32(sequence++),packed])));
}
chunks.push(chunk('IEND',Buffer.alloc(0)));await writeFile(`${root}/petal.apng`,Buffer.concat(chunks));
// Repeat actual GIF image/control blocks, keeping header/palette/Netscape extension.
const gif=await readFile(`${root}/petal.gif`), first=gif.indexOf(Buffer.from([0x21,0xf9,4]));
if(first<0 || gif.at(-1)!==0x3b)throw Error('GIF fixture layout');
await writeFile(`${root}/long.gif`,Buffer.concat([gif.subarray(0,first),...Array.from({length:101},()=>gif.subarray(first,-1)),Buffer.from([0x3b])]));
const ffmpeg=process.env.WW_FFMPEG;
if(ffmpeg) {
  for(const [file,seconds,size] of [['alpha1080.webm',2,'1920:1080'],['long.webm',45,'64:48']]) execFileSync(ffmpeg,['-y','-v','error','-ignore_loop','0','-i',`${root}/petal.apng`,'-t',String(seconds),'-vf',`scale=${size}`,'-r','12','-c:v','libvpx-vp9','-pix_fmt','yuva420p','-auto-alt-ref','0','-deadline','realtime','-cpu-used','8','-b:v','0','-crf','40','-an',`${root}/${file}`],{stdio:'inherit'});
  execFileSync(ffmpeg,['-y','-v','error','-ignore_loop','0','-i',`${root}/petal.apng`,'-t','3','-vf','scale=1080:1080','-r','12','-loop','0',`${root}/large.gif`],{stdio:'inherit'});
  execFileSync(ffmpeg,['-y','-v','error','-ignore_loop','0','-i',`${root}/petal.apng`,'-t','3','-vf','scale=512:512','-r','12','-loop','0',`${root}/medium.gif`],{stdio:'inherit'});
}
const files=['petal.apng','long.gif',...(ffmpeg?['alpha1080.webm','long.webm','large.gif','medium.gif']:[])];
const provenance={generator:'scripts/generate-media-fixtures.mjs',source:'synthetic transparent RGB rectangles; repeated existing petal GIF frames',ffmpeg:ffmpeg?execFileSync(ffmpeg,['-version'],{encoding:'utf8'}).split('\n')[0]:undefined,files:await Promise.all(files.map(async file=>{const bytes=await readFile(`${root}/${file}`);return {file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}))};
await writeFile(`${root}/phase2-source.json`,JSON.stringify(provenance,null,2)+'\n');console.log(JSON.stringify(provenance,null,2));
