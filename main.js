import { Octokit } from 'octokit'
import { paginateGraphql } from '@octokit/plugin-paginate-graphql'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url';
import fs from 'fs-extra'
const NOctokit = Octokit.plugin(paginateGraphql)

import converter from 'json-2-csv'
import { createRequire } from 'module'
import isCidr from 'is-cidr'
import { isIP } from 'is-ip';

import 'dotenv/config'

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

const CreateIpAllowEntryMutation = `
  mutation ($ownerId: ID!, $ip: String!, $name: String) {
    createIpAllowListEntry(
      input: { ownerId: $ownerId, allowListValue: $ip, name: $name, isActive: true }
    ) {
      clientMutationId
      ipAllowListEntry {
        id
        name
        allowListValue
        createdAt
        updatedAt
      }
    }
  }
`

const DeleteIpAllowEntryMutation = `
  mutation ($id: ID!) {
    deleteIpAllowListEntry(input: { ipAllowListEntryId: $id }) {
      clientMutationId
    }
  }
`

/**
 * Retrieves the IP addresses stored in the file with the given `filename`. If the file exists, this
 * function will read it and convert it to a `Map<string, string[]>` of IP addresses to their
 * corresponding names. If the file does not exist, then an empty Map is returned. If there is an
 * error, then the error is returned.
 *
 * @param {string} filename The name of the file containing the saved IP addresses.
 *
 * @returns A `Map<string, string[]>` of IP addresses to their corresponding names or an error.
 */
async function getSavedIPs(filename) {
  try {
    const savedIPs = new Map()

    const pathExists = await fs.pathExists(filename)

    if (pathExists) {
      const data = await fs.readJSON(filename)

      for (const entry of data) savedIPs.set(entry.name, entry.ipList)
    }

    return savedIPs
  } catch (err) {
    console.error(`[getSavedIPs]: Error encountered...`, err)
    return err
  }
}

/**
 * Gets the latest IP addresses used by GitHub Actions and return them as an array of strings. If
 * there is an error, then the error is returned.
 *
 * @param {Octokit} octokit The Octokit instance to use for the request.
 *
 * @returns IP addresses used by GitHub Actions as an array of strings or an error.
 */
async function getGitHubIPs(octokit) {
  try {
    const response = await octokit.request('GET /meta')

    return response.data.actions || []
  } catch (err) {
    console.error(`[getGitHubIPs]: Error encountered...`, err)
    return err
  }
}

/**
 * Gets the current allow list from GitHub and returns it as a "special" `Map`. It maps the name of
 * the allow list entry to an array of objects that contain the entry's id, name, and IP address.
 * These values are used when removing/adding entries to the allow list. It will be returned as the
 * `allowList` property of the returned object along with the `ownerId` property which is the ID of
 * the organization that owns the allow list. If there are no entries in the allow list, then an
 * empty `Map` is returned and if there is an error, then the error is returned.
 *
 * @param {Octokit} octokit The Octokit instance to use for the request.
 *
 * @returns An Object containing the ownerId and a "special" `Map` of the current allow list or an
 * error.
 */
async function getCurrentAllowList(octokit) {
  try {
    const allowList = new Map()
    let ownerId = undefined

    const res = await octokit.graphql.paginate(GetAllowListQuery, {
      login: process.env.ORG_LOGIN,
    })

    if (res.organization.ipAllowListEntries.edges.length !== 0) {
      ownerId = res.organization.ipAllowListEntries.edges[0].node.owner.id

      for (const entry of res.organization.ipAllowListEntries.edges) {
        const allowListEntry = {
          id: entry.node.id,
          name: entry.node.name,
          ip: entry.node.allowListValue,
        }

        if (allowList.has(allowListEntry.name)) {
          allowList.get(allowListEntry.name).push(allowListEntry)
        } else allowList.set(allowListEntry.name, [allowListEntry])
      }
    }

    return { ownerId, allowList }
  } catch (err) {
    console.error(`[getAllowList]: Error encountered...`, err)
    return err
  }
}

/**
 * Gets the IP addresses that need to be removed from the current `allowList` by comparing it to
 * `newIPs` and finding any IP listed in the allowList but not the `newIPs`. If there are no IPs to
 * remove, then an empty `Map` is returned and if there is an error, then the error is returned.
 *
 * @param {Map} allowList A `Map` of the current allow list.
 * @param {Map} newIPs A `Map` of the new IP addresses.
 *
 * @returns A `Map` of the IP addresses to remove from the allow list.
 */
async function getIPsToRemove(allowList, newIPs) {
  try {
    const toRemove = new Map()
    await log(`[getIPsToRemove]: Getting IPs to remove...`)
    for (const [name, entries] of allowList) {
      await log(`[getIPsToRemove]: Checking ${name}...`)
      const newIPList = newIPs.get(name)

      if (newIPList) {
        const ipsToRemove = entries.filter(entry => !newIPList.includes(entry.ip))
        if (ipsToRemove.length !== 0) {
          await log(`[getIPsToRemove]: Removing [${ipsToRemove.length}] from [${name}]`)
          toRemove.set(name, ipsToRemove)
        }
      } else {
        toRemove.set(name, entries)
      }
    }

    return toRemove
  } catch (err) {
    console.error(`[getIPsToRemove]: Error encountered...`, err)
    return err
  }
}

/**
 * Gets the IP addresses that need to be added to the current `allowList` by comparing it to
 * `newIPs` and finding any IP listed in `newIPs` but not the allowList. If there are no IPs to add,
 * then an empty `Map` is returned and if there is an error, then the error is returned.
 *
 * @param {Map} allowList A `Map` of the current allow list.
 * @param {Map} newIPs A `Map` of the new IP addresses.
 *
 * @returns A `Map` of the IP addresses to add to the allow list.
 */
async function getIPsToAdd(allowList, newIPs) {
  try {
    const toAdd = new Map()

    await log(`[getIPsToAdd]: Getting IPs to add...`)
    for (const [name, entries] of newIPs) {
      await log(`[getIPsToAdd]: Checking ${name}...`)

      const oldIPList = allowList.get(name)

      if (oldIPList) {
        const ipsToAdd = []
        const IPlist = []
        for (const objects of oldIPList) {
          IPlist.push(objects.ip)
        }
        for (const ip of entries) {
          if (!IPlist.includes(ip)) {
            const valid = validateIPorCIDR(ip)
            if (valid) {
              console.log(valid)
              await log(`[getIPsToAdd]: ${ip} is valid. Adding...`)
              ipsToAdd.push(ip)
            } else {
              await log(`[getIPsToAdd]: ${ip} is not valid. Skipping...`)
            }
          }
        }

        if (ipsToAdd.length !== 0) {
          await log(`[getIPsToAdd]: Adding [${ipsToAdd.length}] to [${name}]`)
          toAdd.set(name, ipsToAdd)
        }
      } else {
        await log(`[getIPsToAdd]: Validating entries...`)
        const validEntries = entries.filter(filterEntries)
        await log(`[getIPsToAdd]: Validated entries: ${validEntries}`)
        toAdd.set(name, validEntries)
      }
    }

    return toAdd
  } catch (err) {
    console.error(`[getIPsToAdd]: Error encountered...`, err)
    return err
  }
}

function filterEntries(entry) {
  return validateIPorCIDR(entry)
}

async function log(msg) {
  const timestamp = new Date().toISOString()

  console.log(`[${timestamp}]: ${msg}`)

  // Store log message in a file with today's date as the name
  await fs.appendFile(
    join(__dirname, `logs-${timestamp.split('T')[0]}.log`),
    `[${timestamp}]: ${msg}\n`
  )
}

/**
 * Adds the IP addresses in `toAdd` to the allow list. If there are no IPs to add, then an empty
 * array is returned and if there is an error, then the error is returned.
 *
 * @param {Octokit} octokit The Octokit instance to use for the request.
 * @param {string} ownerId The ID of the owner of the allow list.
 * @param {Map} toAdd A `Map` of the IP addresses to add to the allow list.
 *
 * @returns An array of responses from the GraphQL API, if any, or an error.
 */
async function addMissingIPs(octokit, ownerId, toAdd) {
  try {
    const responses = []
    await log(`Adding missing IPs...`)
    for (const [name, ipList] of toAdd) {
      for (const ip of ipList) {
        await log(`${ip} to ${name}`)
        const res = await octokit.graphql(CreateIpAllowEntryMutation, {
          ownerId,
          ip,
          name,
        })

        responses.push(res)
      }
    }

    return responses
  } catch (err) {
    return err
  }
}

/**
 * Removes the IP addresses in `toRemove` from the allow list. If there are no IPs to remove, then
 * an empty array is returned and if there is an error, then the error is returned.
 *
 * @param {Octokit} octokit The Octokit instance to use for the request.
 * @param {Map} toRemove A `Map` of the IP addresses to remove from the allow list.
 *
 * @returns An array of responses from the GraphQL API, if any, or an error.
 */
async function removeExtraIPs(octokit, toRemove) {
  try {
    const responses = []
    await log(`Removing extra IPs...`)
    for (const [name, entries] of toRemove) {
      for (const entry of entries) {
        await log(`${entry.ip} from ${name}`)
        const res = await octokit.graphql(DeleteIpAllowEntryMutation, {
          id: entry.id,
        })

        responses.push(res)
      }
    }

    return responses
  } catch (err) {
    console.error(`[removeExtraIPs]: Error encountered...`, err)
    return err
  }
}

function convertMapsToArrays(toAdd, toRemove, allowList) {
  const toAddArray = []
  const toRemoveArray = []
  const allowListArray = []

  // Populate toAddArray for CSV output.
  for (const [name, entries] of toAdd) {
    toAddArray.push({ name, entries })
  }

  // Populate toRemoveArray for CSV output.
  for (const [name, entries] of toRemove) {
    for (const entry of entries) {
      toRemoveArray.push({ name, ip: entry.ip, id: entry.id })
    }
  }

  // Populate allowListArray for CSV output.
  for (const [name, entries] of allowList) {
    for (const entry of entries) {
      allowListArray.push({ name, ip: entry.ip, id: entry.id })
    }
  }

  return { toAddArray, toRemoveArray, allowListArray }
}

async function outputResults(toAdd, toRemove, allowList) {
  try {
    const timestamp = new Date().toISOString().replace(/:/g, '-')

    const toAddCSVFilePath = join(__dirname, 'output', `To-Add-${timestamp}.csv`)
    const toRemoveCSVFilePath = join(__dirname, 'output', `To-Remove-${timestamp}.csv`)
    const allowListCSVFilePath = join(__dirname, 'output', `Current-Allow-List-${timestamp}.csv`)

    const { allowListArray, toAddArray, toRemoveArray } = convertMapsToArrays(
      toAdd,
      toRemove,
      allowList
    )

    const toAddCSV = await converter.json2csv(toAddArray)
    const toRemoveCSV = await converter.json2csv(toRemoveArray)
    const allowListCSV = await converter.json2csv(allowListArray)

    await fs.ensureDir(join(__dirname, 'output'))

    return Promise.all([
      fs.writeFile(toAddCSVFilePath, toAddCSV),
      fs.writeFile(toRemoveCSVFilePath, toRemoveCSV),
      fs.writeFile(allowListCSVFilePath, allowListCSV),
    ])
  } catch (err) {
    console.error(`[outputArchive]: Error encountered...`, err)
    return err
  }
}

function validateIPorCIDR(ip) {
  if (ip.includes('/')) {
    return isCidr(ip)
  } else {
    return isIP(ip)
  }
}

async function main() {
  try {
    const octokit = new NOctokit({ auth: process.env.GH_TOKEN })

    const newIPs = new Map()

    const gitHubIPs = await getGitHubIPs(octokit)

    newIPs.set('GitHub Actions', gitHubIPs)

    const savedIPs = await getSavedIPs('ip.json')

    for (const [name, ipList] of savedIPs) newIPs.set(name, ipList)

    const { allowList, ownerId } = await getCurrentAllowList(octokit)

    const toRemove = await getIPsToRemove(allowList, newIPs)
    const toAdd = await getIPsToAdd(allowList, newIPs)

    await addMissingIPs(octokit, ownerId, toAdd)

    await removeExtraIPs(octokit, toRemove)

    await outputResults(toAdd, toRemove, allowList)
  } catch (err) {
    console.error(`[main]: Error encountered...`, err)
    return err
  }
}

module.exports = async () => {
  try {
    await main()

    log(`[module.exports]: Successfully completed.`)
  } catch (err) {
    console.error(`[module.exports]: Error encountered...`, err)
    return err
  }
}
