#!/usr/bin/env node
import util from 'node:util'
import childProcess from 'node:child_process'
import { fileURLToPath } from 'url'
import { promises as fs } from 'fs'
import path from 'path'

const exec = util.promisify(childProcess.exec)

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const getLastMod = async () => {
  const { stdout, stderr } = await exec('git show HEAD:mods.json')
  // console.log('stdout:', stdout)
  // console.error('stderr:', stderr)
  return stdout
}
const getCurrentMod = () =>
  fs.readFile(path.join(__dirname, '../mods.json'))

;(async () => {
  const [oldMod, newMod] = (await Promise.all([getLastMod(), getCurrentMod()])).map(mod => JSON.parse(mod))

  const diff = Object.entries(newMod.mods).filter(([key, value]) => {
    return value !== oldMod.mods[key]
  }).toSorted((a, b) => a[0].localeCompare(b[0]))

  const modNames = diff.map(mod => mod[0])
  const header = `|mod|old|new|
|---|---|---|`
  const modDescription = diff.map(mod => {
    return `|[${mod[0]}](https://mods.vintagestory.at/${mod[0]})|${oldMod.mods[mod[0]]}|${mod[1]}|`
  }).join('\n')

  console.log(modNames.join(', '))
  console.log(header)
  console.log(modDescription)
})()
