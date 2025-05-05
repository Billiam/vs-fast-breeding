import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const modData = async () => {
  const mods = JSON.parse(
    await fs.readFile(path.join(__dirname, '../../mods.json')),
  )

  const modIds = Object.keys(mods.mods)
  const groupIndex = Object.entries(mods.groups).reduce(
    (lookup, [group, groupData]) => {
      groupData.list.forEach((modId) => {
        lookup[modId.toLowerCase()] = group
      })
      return lookup
    },
    {},
  )

  return {
    mods: modIds,
    groupIndex,
    groups: mods.groups,
  }
}
