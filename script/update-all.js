#!/usr/bin/env node
import { promises as fs } from 'fs'
import stringify from 'json-stable-stringify'
import path from 'path'
import { fileURLToPath } from 'url'

import updateMod from './lib/update-mod.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const options = process.argv.slice(2).filter((arg) => arg.startsWith('--'))

const opts = options.reduce((list, option) => {
  const parsed = option.match(/^--([^=]+)(?:=(.*))?/)
  list[parsed[1]] = parsed[2] === '' || parsed[2] == null ? true : parsed[2]
  return list
}, {})

;(async () => {
  const modsConfigPath = path.join(__dirname, '../mods.json')
  const modVersions = JSON.parse(await fs.readFile(modsConfigPath, 'utf8'))

  const modIds = Object.keys(modVersions.mods)
  for (const modId of modIds) {
    //TODO: limit updates to targeted VS versions
    try {
      const lastVersion = opts.force ? null : modVersions.mods[modId]
      const newVersion = await updateMod(modId, lastVersion)
      if (newVersion) {
        modVersions.mods[modId] = newVersion
      }
    } catch (err) {
      console.error(`Error updating mod (${modId}):`, err.message)
    }
  }

  return fs.writeFile(
    modsConfigPath,
    stringify(modVersions, { space: '  ' }) + '\n',
  )
})()
