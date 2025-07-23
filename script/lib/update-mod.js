import patch from '../patch.js'
import semver from 'semver'

import fetchZip from './fetch-zip.js'

export default async (modId, lastVersion) => {
  console.log('Updating', modId)
  const response = await fetch(
    `https://mods.vintagestory.at/api/mod/${modId}`,
    { redirect: 'follow' },
  )
  const data = await response.json()

  if (data.statuscode === '200') {
    const latestRelease = data.mod.releases.find(release => !/pre/.test(release.modversion))
    const releaseNewer =
      !lastVersion || semver.gt(latestRelease.modversion, lastVersion)

    if (releaseNewer) {
      console.log(
        'Fetching newer release',
        `${lastVersion} -> ${latestRelease.modversion}`,
      )
      const zipPath = await fetchZip(
        latestRelease.mainfile,
        latestRelease.filename,
      )
      await patch(zipPath)

      return latestRelease.modversion
    }
  } else {
    console.error(data)
    throw new Error('Expected 200 status, received', data.statuscode)
  }
}
