#!/usr/bin/env node
import { promises as fs } from 'fs'
import stringify from 'json-stable-stringify'
import path from 'path'
import { fileURLToPath } from 'url'

import updateMod from './lib/update-mod.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const partition = (arr, fn) =>
  arr.reduce(
    (acc, val, i, arr) => {
      acc[fn(val, i, arr) ? 0 : 1].push(val)
      return acc
    },
    [[], []],
  )
const [mods, options] = partition(
  process.argv.slice(2),
  (val) => !val.startsWith('--'),
)
console.log({ mods, options })

const opts = options.reduce((list, option) => {
  const parsed = option.match(/^--([^=]+)(?:=(.*))?/)
  list[parsed[1]] = parsed[2] === '' || parsed[2] == null ? true : parsed[2]
  return list
}, {})

;(async () => {
  const modId = mods[0]

  const modsConfigPath = path.join(__dirname, '../mods.json')
  const modVersions = JSON.parse(await fs.readFile(modsConfigPath, 'utf8'))

  const newVersion = await updateMod(modId, null)
  if (newVersion) {
    modVersions.mods[modId] = newVersion
    return fs.writeFile(
      modsConfigPath,
      stringify(modVersions, { space: '  ' }) + '\n',
    )
  } else {
    console.error('Mod could not be updated')
  }
})()
