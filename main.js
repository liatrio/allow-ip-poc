const { Octokit } = require('octokit')
const { paginateGraphql } = require('@octokit/plugin-paginate-graphql')
const fs = require('fs-extra')
// const { createSpinner } = require('nanospinner')

// const spinner = createSpinner('Loading...').start()

const NOctokit = Octokit.plugin(paginateGraphql)

require('dotenv').config()

const GetAllowListQuery = `
query paginate($cursor: String, $login: String!) {
  organization(login: $login) {
    ipAllowListEntries(first: 100, after: $cursor) {
      totalCount

      edges {
        node {
          id
          name
          owner {
            ... on Organization {
              id
              login
            }
          }
          isActive
          allowListValue
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
`

async function log(msg) {
  const message = `[${new Date().toDateString()}]: ${msg}`

  console.log(message)

  await fs.appendFile('log.txt', `${message}\n`)
}

/**
 * Retrieves the IP addresses stored in the file with the given `filename`. If the file exists, this
 * function will read it and convert it to a `Map<string, string[]>` of IP addresses to their
 * corresponding names. If the file does not exist, then an empty Map is returned.
 *
 * @param {string} filename The name of the file containing the saved IP addresses.
 *
 * @returns A `Map<string, string[]>` of IP addresses to their corresponding names.
 */
async function getSavedIPs(filename) {
  try {
    const savedIPs = new Map()

    const pathExists = await fs.pathExists(filename)

    if (pathExists) {
      // await log(`[getSavedIPs]: Reading from ${filename}...`)
      const data = await fs.readJSON(filename)

      for (const entry of data) savedIPs.set(entry.name, entry.ipList)
    }

    return savedIPs
  } catch (err) {
    console.error(`[getSavedIPs]: Error encountered...`, err)
    return err
  }
}

async function getGitHubIPs(octokit) {
  try {
    const response = await octokit.request('GET /meta')

    return response.data.actions || []
  } catch (err) {
    console.error(`[getGitHubIPs]: Error encountered...`, err)

    return err
  }
}

async function getCurrentAllowList(octokit) {
  try {
    const allowList = new Map()

    const res = await octokit.graphql.paginate(GetAllowListQuery, {
      login: process.env.ORG_LOGIN,
    })

    if (res.organization.ipAllowListEntries.edges.length !== 0) {
      for (const entry of res.organization.ipAllowListEntries.edges) {
        const name = entry.node.name
        const ip = entry.node.allowListValue

        // await log(`[getCurrentAllowList]: Adding ${name} with IP ${ip} to allow list...`)

        if (allowList.has(name)) allowList.get(name).push(ip)
        else allowList.set(name, [ip])
      }
    }

    // Log how many entries are in the allowList.
    // await log(`[getCurrentAllowList]: allowList.size = ${allowList.size}`)

    return allowList
  } catch (err) {
    console.error(`[getAllowList]: Error encountered...`, err)
    return err
  }
}

function getIPsToRemove(allowList, newIPs) {
  try {
    const toRemove = new Map()

    console.log('[getIPsToRemove]: Iterating over allowList...')
    for (const [name, ipList] of allowList) {
      const newIPList = newIPs.get(name)

      if (newIPList) {
        console.log(`[getIPsToRemove]: Retrieved ${name}'s newIPList...`)
        console.log(`[getIPsToRemove]: newIPList.length = ${newIPList.length}`)

        const ipsToRemove = ipList.filter(ip => !newIPList.includes(ip))

        if (ipsToRemove.length !== 0) toRemove.set(name, ipsToRemove)
      }
    }

    return toRemove
  } catch (err) {
    console.error(`[getIPsToRemove]: Error encountered...`, err)
    return err
  }
}

function getIPsToAdd(allowList, newIPs) {
  try {
    const toAdd = new Map()

    console.log('[getIPsToAdd]: Iterating over newIPs...')

    for (const [name, ipList] of newIPs) {
      const oldIPList = allowList.get(name)

      if (oldIPList) {
        console.log(`[getIPsToAdd]: Retrieved ${name}'s oldIPList...`)
        console.log(`[getIPsToAdd]: oldIPList.length = ${oldIPList.length}`)

        const ipsToAdd = ipList.filter(ip => !oldIPList.includes(ip))

        if (ipsToAdd.length !== 0) toAdd.set(name, ipsToAdd)
      } else {
        console.log(`[getIPsToAdd]: ${name} is not in the allow list...`)
        console.log(`[getIPsToAdd]: Adding ${name} with IP ${ipList} to allow list...`)

        toAdd.set(name, ipList)
      }
    }

    return toAdd
  } catch (err) {
    console.error(`[getIPsToAdd]: Error encountered...`, err)
    return err
  }
}

async function main() {
  try {
    // ;(await fs.pathExists('log.txt')) ? await fs.remove('log.txt') : null
    const octokit = new NOctokit({ auth: process.env.GH_TOKEN })

    const newIPs = new Map()

    // Get the current GitHub IP addresses.
    const gitHubIPs = await getGitHubIPs(octokit)

    newIPs.set('GitHub Actions', gitHubIPs)

    // Log the size of newIPs and the length of the first value.
    // await log(`[main]: newIPs.size = ${newIPs.size}`)
    // await log(
    //   `[main]: newIPs.get('GitHub Actions').length = ${newIPs.get('GitHub Actions').length}`
    // )

    // Get the saved IP addresses.
    const savedIPs = await getSavedIPs('ip.json')

    // await log(`[main]: Retrieved ${savedIPs.size} saved IP lists.`)

    // Add the savedIPs to the newIPs Map.
    for (const [name, ipList] of savedIPs) newIPs.set(name, ipList)

    // await log('[main]: Added saved IPs to newIPs Map.')

    // await log(`[main]: Getting current allow list...`)

    const allowList = await getCurrentAllowList(octokit)

    // await log(`[main]: allowList.size = ${allowList.size}`)

    // for (const [name, ipList] of allowList) {
    //   await log(`[main]: ${name} has ${ipList.length} IP addresses.`)
    // }

    // await log(`[main]: Logging allowList...`)
    // await log(JSON.stringify(allowList, null, 2))
    await fs.writeJSON('allowList.json', [...allowList])

    // await log(`[main]: Logging newIPs...`)
    // await log(JSON.stringify(newIPs, null, 2))
    await fs.writeJSON('newIPs.json', [...newIPs])

    // await log(`[main]: Getting IPs to remove...`)
    const toRemove = getIPsToRemove(allowList, newIPs)

    // await log(`[main]: Getting IPs to add...`)
    const toAdd = getIPsToAdd(allowList, newIPs)

    // await log(`[main]: toAdd = ${JSON.stringify(toAdd, null, 2)}`)
    // await log(`[main]: toRemove = ${JSON.stringify(toRemove, null, 2)}`)
  } catch (err) {
    console.error(`[main]: Error encountered...`, err)
    return err
  }
}

// module.exports = () => {
//   return main()
// }

main()
  .then(() => {
    // return log(`[main]: Finished!`)
    console.log(`[main]: Finished!`)
  })
  .catch(err => {
    console.error(`[main]: Error encountered...`, err)
  })
