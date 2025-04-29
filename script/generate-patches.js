#!/usr/bin/env node
import path from 'path'
import patch from './patch.js'
import { glob } from 'glob'

const partition = (arr, fn) =>
  arr.reduce(
    (acc, val, i, arr) => {
      acc[fn(val, i, arr) ? 0 : 1].push(val)
      return acc
    },
    [[], []]
  )
const args = process.argv.slice(2)

const [dirs, options] = partition(args, val => !val.startsWith('--'))

const patchList = [
  {
    input: ['land/pig-wild-*.json'],
    output: 'land/pig-wild.json',
    key: 'PIG_CYCLE',
  },
  {
    input: ['land/hooved/goat.json'],
    output: 'land/hooved/goat.json',
    key: 'GOAT_CYCLE',
  },
  {
    input: ['land/sheep-bighorn-*.json'],
    output: 'land/sheep-bighorn.json',
    key: 'SHEEP_CYCLE',
  },
  {
    input: ['land/chicken-*.json'],
    output: 'land/chicken.json',
    key: 'CHICKEN_CYCLE',
  },
  {
    input: ['land/hare-*.json'],
    output: 'land/hare.json',
    key: 'HARE_CYCLE',
  },

]

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
  for (const { input, output, key } of patchList) {
    const files = (await Promise.all(input.map(globPath =>
      glob(path.join(entityDir, globPath))
    ))).flat()

    await patch(files, { patchOutput: output, settingKey: key })
  }
})()
