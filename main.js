const { Octokit } = require('octokit')
const { paginateGraphql } = require('@octokit/plugin-paginate-graphql')
const fs = require('fs')

const NOctokit = Octokit.plugin(paginateGraphql)

require('dotenv').config()

const GetAllowListQuery = `
query paginate($cursor: String) {
  organization(login: "liatrio") {
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

const MutationCreateIpAllowEntry = `
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

/**
 * Attempts to get an array of IP addresses from the GitHub API `/meta`
 * endpoint using the provided Octokit instance. If none are found,
 * then an empty array is returned.
 *
 * @param {*} octokit The Octokit instance.
 *
 * @returns An array of IP addresses or an empty array.
 */
async function getGitHubIPs(octokit) {
  try {
    const response = await octokit.request('GET /meta')
    if (response.data.actions) return response.data.actions
    return []

    // Ternary operator version.
    // return response.data.actions ? response.data.actions : []
  } catch (err) {
    console.error(`[getGitHubIPs]: Error encountered...`, err)

    return err
  }
}

const addMissingIPs = async (octokit, name, ips, ownerId) => {
  try {
    for (const ip of ips) {
      console.debug(`Adding ${ip} to allow list...`)

      const mutation = await octokit.graphql(MutationCreateIpAllowEntry, {
        ownerId,
        ip,
        name: name,
      })

      console.debug(JSON.stringify(mutation, null, 2))
    }
  } catch (err) {
    console.error(`[main]: Error encountered...`, err)
    return err
  }
}

function diffLists(allowListIPs, listIPs) {
  try {
    const diff = listIPs.filter(ip => !allowListIPs.includes(ip))

    return diff
  } catch (err) {
    return err
  }
}

function diffMap(allowList, allIPs) {
  try {
    const allowListIPs = allowList.entries.map(entry => entry.node.allowListValue)
    const diffIPs = new Map();

    for (var entry of allIPs.entries()) {
      var nameIP = entry[0],
          listIPs = entry[1];
      diffIPs.set(nameIP, diffLists(allowListIPs, listIPs))
    }

    return diffIPs
  } catch (err) {
    return err
  }
}

const getAllowList = async octokit => {
  try {
    const allowList = await octokit.graphql.paginate(GetAllowListQuery)

    if (allowList.organization.ipAllowListEntries.edges.length === 0) {
      console.debug('No entries found')

      return {
        ownerId: '',
        entries: [],
      }
    } else {
      return {
        ownerId: allowList.organization.ipAllowListEntries.edges[0].node.owner,
        entries: allowList.organization.ipAllowListEntries.edges,
      }
    }
  } catch (err) {
    console.error(`[getAllowList]: Error encountered...`, err)
    return err
  }
}

function getManagedIPs(filename){
  try {
    if (fs.existsSync(filename)){
      const fileContents = fs.readFileSync(filename, 'utf8')
      const ipData = JSON.parse(fileContents)
      return ipData
    }
  } catch(err) {
    console.error(`[getManagedIPs]: Error encountered...`, err)
    return err
  }
}

async function main() {
  try {
    const octokit = new NOctokit({ auth: process.env.GH_TOKEN })

    const allIPs = new Map();

    const managedIPs = getManagedIPs('./ip.json')

    if (managedIPs != null){
      for(var attributename in managedIPs){
        allIPs.set(managedIPs[attributename]["name"], managedIPs[attributename]["ipList"]);
      }
    }

    const allowList = await getAllowList(octokit)

    const ghIPs = await getGitHubIPs(octokit)

    allIPs.set('GitHub Actions', ghIPs)

    const mapDiff = diffMap(allowList, allIPs)

    for (var entry of mapDiff.entries()) {
      const nameIP = entry[0]
      const listDiff = entry[1]
      if (listDiff.length > 0) {
        console.log('Adding missing IPs to allow list...')
        await addMissingIPs(octokit, nameIP, listDiff, allowList.ownerId.id)
      }
    }
  } catch (err) {
    console.error(`[main]: Error encountered...`, err)
    return err
  }
}

module.exports = ({ github, context }) => {
  return main()
}

// const getUser = async () => {
//   const allow_list = await octokit.graphql(GetAllowListQuery)
//   console.log(JSON.stringify(allow_list, null, 2))
// }

// getGitHubIPs(octokit)
//   .then(res => {})
//   .then(res => writeJson('./tmp.json', res, { spaces: 2 }))
//   .then(res => {
//     console.log(JSON.stringify(res, null, 2))
//     console.log('Execution completed successfully')
//   })
//   .catch(e => console.error(e))
