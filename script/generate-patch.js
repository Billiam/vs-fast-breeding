#!/usr/bin/env node
import fs from 'node:fs'
import path from 'path'
import json5 from 'json5'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url) // get the resolved path to the file
const __dirname = path.dirname(__filename)

const partition = (arr, fn) =>
  arr.reduce(
    (acc, val, i, arr) => {
      acc[fn(val, i, arr) ? 0 : 1].push(val)
      return acc
    },
    [[], []]
  )
const args = process.argv.slice(2)

const [files, options] = partition(args, val => !val.startsWith('--'))
const opts = options.reduce((list, option) => {
  const parsed = option.match(/^--(.*?)=(.*)/)
  list[parsed[1]] = parsed[2]
  return list
}, {})

const targets = ['hoursToGrow', 'pregnancyDays', 'multiplyCooldownDaysMin', 'multiplyCooldownDaysMax']

const output = []

const buildPatch = (file, suffix, key, value) => {
  const filePrefix = opts.mod ?? 'game'
  const patch = {
    file: `${filePrefix}:${file}`,
    op: 'replace',
    path: `/server/behaviors/${suffix}${key}`,
    value: Math.ceil(value * 0.5)
  }

  if (opts.mod) {
    patch.dependsOn = [{ modId: opts.mod }]
  }

  return patch
}

const configLibPatches = {}
const settingKey = opts.setting ?? 'KEY_CYCLE'

const addPatch = (file, suffix, key, value) => {
  const patch = buildPatch(file, suffix, key, value)
  output.push(patch)

  if (opts.output) {
    const configKey = `${output.length - 1}/value`
    let configValue = `round(${settingKey} * ${value})`
    if (suffix.includes('hoursToGrow')) {
      configValue = `max(1, ${configValue})`
    }
    configLibPatches[configKey] = configValue
  }
}

files.forEach(file => {
  const patchPath = file.match(/entities.*/)[0]

  const data = json5.parse(fs.readFileSync(file, 'utf8'))

  data.server.behaviors.forEach((behavior, behaviorIndex) => {
    const suffix = `${behaviorIndex}/`
    Object.entries(behavior).forEach(([key, value]) => {
      const keyWithoutType = key.replace(/ByType$/, '')
      if (targets.includes(key)) {
        addPatch(patchPath, suffix, key, value)
      } else if (targets.includes(keyWithoutType)) {
        Object.entries(value).forEach(([typeName, value]) => {
          addPatch(patchPath, `${suffix}${key}/`, typeName, value)
        })
      }
    })
  })
})

if (opts.output) {
  const patchPath = path.resolve(__dirname, `../src/assets/fastbreeding/${opts.output}`)
  fs.writeFileSync(patchPath, JSON.stringify(output, null, 2))

  const configLibFile = path.resolve(__dirname, '../src/assets/fastbreeding/config/configlib-patches.json')
  const configLibData = JSON.parse(fs.readFileSync(configLibFile, 'utf8'))

  const outputKey = `fastbreeding:${opts.output}`
  configLibData.patches.integer[outputKey] = configLibPatches

  fs.writeFileSync(configLibFile, JSON.stringify(configLibData, null, 2))
}

process.stdout.write(JSON.stringify({ patch: output }, null, 2))
