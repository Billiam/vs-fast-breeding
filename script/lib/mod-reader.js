import { promises as fs } from 'fs'
import { glob } from 'glob'
import json5 from 'json5'
import StreamZip from 'node-stream-zip'

export class DirectoryModReader {
  constructor(path) {
    this.path = path
  }

  get modId() {
    if (!this._modPromise) {
      this._modPromise = new Promise(async (resolve, reject) => {
        const fileData = await fs.readFile(
          path.join(this.path, 'modinfo.json'),
          'utf8',
        )

        const modIdKey = Object.keys(fileData).find(
          (key) => key.toLowerCase() === 'modid',
        )
        const modId = fileData[modIdKey]

        if (modId) {
          resolve(modId.toLowerCase())
        } else {
          reject('Mod ID could not be found')
        }
      })
    }
    return this._modPromise
  }

  async *filteredFiles(path) {
    const modId = await this.modId
    const jsonGlob = path.join(this.path, `assets/${modId}/${path}/**/*.json`)
    const fileList = await glob(jsonGlob, {})
    for (const file of fileList) {
      let data
      try {
        data = json5.parse(await fs.readFile(file, 'utf8'))
      } catch (e) {
        console.error('Could not parse file', file)
        continue
      }

      yield {
        file,
        data,
      }
    }
  }

  // compatibility files?
  files() {
    return this.filteredFiles('entities')
  }

  patches() {
    return this.filteredFiles('patches')
  }

  cleanup() {}
}

export class PathReader {
  constructor(paths, modId) {
    this.paths = paths
    this.modid = modId
  }

  async *files() {
    for (const file of this.paths) {
      let data
      try {
        data = json5.parse(await fs.readFile(file, 'utf8'))
      } catch (e) {
        console.error('Could not parse file', file)
        continue
      }

      yield {
        file,
        data,
      }
    }
  }

  patches() {
    return []
  }

  cleanup() {}
}

export class ZipModReader {
  constructor(path) {
    this.path = path
  }

  get zipFile() {
    if (!this.zip) {
      this.zip = new StreamZip.async({ file: this.path })
    }
    return this.zip
  }

  async cleanup() {
    if (this.zip) {
      return this.zip.close()
    }
  }

  get modId() {
    if (!this._modPromise) {
      this._modPromise = new Promise(async (resolve, reject) => {
        const buffer = await this.zipFile.entryData('modinfo.json')
        const manifest = buffer.toString()
        const manifestData = json5.parse(manifest)
        const modIdKey = Object.keys(manifestData).find(
          (key) => key.toLowerCase() === 'modid',
        )
        const modId = manifestData[modIdKey]

        if (modId) {
          resolve(modId.toLowerCase())
        } else {
          reject('Mod ID could not be found')
        }
      })
    }
    return this._modPromise
  }

  async *filteredFiles(path) {
    const modId = await this.modId
    const zipFile = await this.zipFile
    const entries = await zipFile.entries()

    const fileList = Object.keys(entries).filter((filename) => {
      return (
        filename.startsWith(`assets/${modId}/${path}/`) &&
        filename.endsWith('.json')
      )
    })

    for (const file of fileList) {
      const entry = await zipFile.entryData(file)
      let data
      try {
        data = json5.parse(entry.toString())
      } catch (e) {
        console.error('Could not parse file', file)
        continue
      }
      yield {
        file,
        data,
      }
    }
  }

  patches() {
    return this.filteredFiles('patches')
  }

  files() {
    return this.filteredFiles('entities')
  }
}

export const readerFromPath = (modPath) => {
  if (Array.isArray(modPath)) {
    return PathReader
  } else if (modPath.endsWith('.zip')) {
    return ZipModReader
  } else {
    return DirectoryModReader
  }
}
