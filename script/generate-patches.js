#!/usr/bin/env node
import vanillaAnimals from '../vanilla-animals.json' with { type: 'json' }
import { glob } from 'glob'
import path from 'path'

import patch from './patch.js'

const partition = (arr, fn) =>
  arr.reduce(
    (acc, val, i, arr) => {
      acc[fn(val, i, arr) ? 0 : 1].push(val)
      return acc
    },
    [[], []],
  )
const args = process.argv.slice(2)

const [dirs, options] = partition(args, (val) => !val.startsWith('--'))

const opts = options.reduce((list, option) => {
  const parsed = option.match(/^--([^=]+)(?:=(.*))?/)
  list[parsed[1]] = parsed[2] === '' || parsed[2] == null ? true : parsed[2]
  return list
}, {})

;(async () => {
  const entityDir = dirs[0]

  if (!entityDir) {
    throw new Error('Mod directory or file paths are required')
  }
  for (const { input, output, key, dependsOn } of vanillaAnimals) {
    const files = (
      await Promise.all(
        input.map((globPath) => glob(path.join(entityDir, globPath))),
      )
    ).flat()

    await patch(files, { patchOutput: output, settingKey: key, dependsOn })
  }
})()
