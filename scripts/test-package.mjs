import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,mkdir,rm,access} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'

const exec=promisify(execFile)
const root=fileURLToPath(new URL('../',import.meta.url))
const temporary=await mkdtemp(join(tmpdir(),'pcb-package-'))
const run=async(executable,args,cwd)=>{
  try{
    return await exec(executable,args,{cwd,timeout:180000,maxBuffer:8*1024*1024})
  }
  catch(error){throw Error(`${executable} ${args.join(' ')}\n${error.stdout??''}\n${error.stderr??error.message}`)}
}
try {
  const packed=JSON.parse((await run('npm',['pack','--json','--pack-destination',temporary],root)).stdout)[0]
  assert.ok(packed.files.every(file=>file.path.startsWith('dist/')||[
    'README.md',
    'LICENSE',
    'package.json',
  ].includes(file.path)))
  const privateModules = ['setup', 'runtime', 'cli', 'pipeline']
  assert.ok(!packed.files.some(file => privateModules.some(name => file.path.includes(`dist/${name}.`))))
  const consumer=join(temporary,'consumer')
  await mkdir(consumer)
  await writeFile(join(consumer,'package.json'),JSON.stringify({type:'module',private:true}))
  await run('npm',[
    'install',
    '--ignore-scripts',
    '--legacy-peer-deps',
    '--no-audit',
    '--no-fund',
    join(temporary,packed.filename),
  ],consumer)
  const installed=join(consumer,'node_modules/@tscircuit/signal-integrity-pipeline')
  await assert.rejects(access(join(installed,'src')),{code:'ENOENT'})
  await assert.rejects(access(join(consumer,'node_modules/react')),{code:'ENOENT'})
  // circuit-json is a peer: the package never installs its own copy into a host tree.
  await assert.rejects(access(join(consumer,'node_modules/circuit-json')),{code:'ENOENT'})
  // Hosts supply circuit-json, as tscircuit does for core and the other converters.
  const circuitJsonVersion=JSON.parse(await readFile(join(root,'package.json'),'utf8')).devDependencies['circuit-json']
  await run('npm',[
    'install',
    '--ignore-scripts',
    '--legacy-peer-deps',
    '--no-audit',
    '--no-fund',
    `circuit-json@${circuitJsonVersion}`,
  ],consumer)
  const manifest=JSON.parse(await readFile(join(installed,'package.json'),'utf8'))
  assert.equal(manifest.name,'@tscircuit/signal-integrity-pipeline')
  assert.equal(manifest.main,'./dist/index.js')
  assert.equal(manifest.types,'./dist/index.d.ts')
  assert.equal(manifest.scripts.prepare,undefined)
  assert.ok(Object.values(manifest.peerDependenciesMeta).every(peer=>peer.optional))
  const smoke=`import assert from 'node:assert/strict';
import {stackupFromCircuitJson,transmittedBits} from '@tscircuit/signal-integrity-pipeline';
import {createNativeSolver,loadIbisSources} from '@tscircuit/signal-integrity-pipeline/node';
assert.equal(typeof stackupFromCircuitJson,'function')
assert.equal(typeof transmittedBits,'function')
assert.equal(typeof createNativeSolver,'function')
assert.equal(typeof loadIbisSources,'function')`
  await writeFile(join(consumer,'smoke.mjs'),smoke)
  await run(process.execPath,['smoke.mjs'],consumer)
} finally {await rm(temporary,{recursive:true,force:true})}
