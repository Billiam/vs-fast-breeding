#!/usr/bin/env node
import { fileURLToPath } from 'url'
import path from 'path'
import { promises as fs } from 'fs'
import json5 from 'json5'
import sortedKeys from './lib/sorted-keys.js'
import stringify from 'json-stable-stringify'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const buildCycleSetting = key => {
  const mod = key.toLowerCase().replace(/_cycle$/, '')

  return {
    type: 'float',
    comment: 'cycle-comment',
    default: 0.5,
    logarithmic: true,
    range: {
      min: 0,
      max: 10
    }
  }
}

(async () => {
  const settingsPath = path.resolve(__dirname, '../settings.json5')
  const settingsConfig = json5.parse(await fs.readFile(settingsPath, 'utf8'))

  const configLibPath = path.resolve(__dirname, '../src/assets/fastbreeding/config/configlib-patches.json')
  const configLibData = JSON.parse(await fs.readFile(configLibPath, 'utf8'))

  configLibData.settings = {}
  configLibData.formatting = []
  settingsConfig.forEach((setting, index) => {
    setting.weight = index

    if (setting.type === 'separator') {
      configLibData.formatting.push(setting)

      return
    }

    const key = setting.key
    delete setting.key

    if (setting.type === 'cycle') {
      setting = buildCycleSetting(key)
      setting.weight = index
    }

    const type = setting.type
    delete setting.type
    setting.name ||= key.toLowerCase().replace('_', '-')
    setting.ingui ||= `fastbreeding:${setting.name}`

    configLibData.settings[type] ||= {}
    configLibData.settings[type][key] = setting
  })

  return fs.writeFile(configLibPath, stringify(configLibData, { cmp: sortedKeys, space: '  ' }) + '\n')
})()
