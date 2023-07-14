const { Octokit } = require('octokit')
const { paginateGraphql } = require('@octokit/plugin-paginate-graphql')
const fs = require('fs')

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

    if (await fs.pathExists(filename)) {
      console.log(`[getSavedIPs]: Reading from ${filename}...`)
      const data = await fs.readJSON(filename)

      for (const entry of data) {
        savedIPs.set(entry.name, entry.ipList)
      }
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

        console.log(`[getCurrentAllowList]: Adding ${name} with IP ${ip} to allow list...`)

        allowList.set(name, ip)
      }
    }

    return allowList
  } catch (err) {
    console.error(`[getAllowList]: Error encountered...`, err)
    return err
  }
}

async function main() {
  try {
    const octokit = new NOctokit({ auth: process.env.GH_TOKEN })

    const newIPs = new Map()

    // Get the current GitHub IP addresses.
    const gitHubIPs = await getGitHubIPs(octokit)

    newIPs.set('GitHub-Actions', gitHubIPs)

    // Get the saved IP addresses.
    const savedIPs = await getSavedIPs('ip.json')

    // Add the savedIPs to the newIPs Map.
    for (const [name, ipList] of savedIPs) newIPs.set(name, ipList)

    const allowList = await getCurrentAllowList(octokit)

    const toAdd = new Map()
    const toRemove = new Map()

    // Compare the newIPs to the allowList.
    for (const [name, ipList] of newIPs) {
      if (allowList.size > 0 && allowList.has(name)) {
        // If the allowList has the name, then compare the IP addresses.
        const allowListIPs = allowList.get(name)

        // Go through each IP address in the ipList and check if it is in the allowListIPs.
        for (const ip of ipList) {
          if (!allowListIPs.includes(ip)) {
            // If the IP address is not in the allowListIPs, then add it to the toAdd Map.
            if (!toAdd.has(name)) toAdd.set(name, [])

            toAdd.get(name).push(ip)
          } else {
            // If the IP is in the allowList but not in the newIPs, then add it to the toRemove Map.
            if (!toRemove.has(name)) toRemove.set(name, [])

            toRemove.get(name).push(ip)
          }
        }
      }
    }

    console.log(`[main]: toAdd = ${JSON.stringify(toAdd, null, 2)}`)
    console.log(`[main]: toRemove = ${JSON.stringify(toRemove, null, 2)}`)
  } catch (err) {
    console.error(`[main]: Error encountered...`, err)
    return err
  }
}

module.exports = () => {
  return main()
}
