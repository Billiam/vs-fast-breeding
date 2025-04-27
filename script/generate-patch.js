#!/usr/bin/env node
import patch from './patch.js'

const partition = (arr, fn) =>
  arr.reduce(
    (acc, val, i, arr) => {
      acc[fn(val, i, arr) ? 0 : 1].push(val)
      return acc
    },
    [[], []]
  )
const args = process.argv.slice(2)

const [mods, options] = partition(args, val => !val.startsWith('--'))

const opts = options.reduce((list, option) => {
    const parsed = option.match(/^--(.*?)=(.*)/)
    list[parsed[1]] = parsed[2]
    return list
  }, {})

;(async () => {
  const modDir = mods[0]

  if (!modDir) {
    throw new Error('Mod directory is required and must exist')
  }
  patch(modDir)
})()
