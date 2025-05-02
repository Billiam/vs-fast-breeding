import { createWriteStream, existsSync, promises as fs } from 'fs'
import { Readable } from 'node:stream'
import path from 'path'
import { finished } from 'stream/promises'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default async (url, filename) => {
  console.log('Fetching', url)
  const tmpDirPath = path.resolve(__dirname, '../tmp')

  const destination = path.join(tmpDirPath, filename)
  if (existsSync(destination)) {
    return destination
  }

  if (!existsSync(tmpDirPath)) {
    await fs.mkdir(tmpDirPath)
  }

  const res = await fetch(url, { redirect: 'follow' })

  const fileStream = createWriteStream(destination, { flags: 'w' })
  await finished(Readable.fromWeb(res.body).pipe(fileStream))

  return destination
}
