const { Octokit } = require('octokit')
const { paginateGraphql } = require('@octokit/plugin-paginate-graphql')

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

const addMissingIPs = async (octokit, ips, ownerId) => {
  try {
    for (const ip of ips) {
      console.debug(`Adding ${ip} to allow list...`)

      const mutation = await octokit.graphql(MutationCreateIpAllowEntry, {
        ownerId,
        ip,
        name: 'GitHub Actions',
      })

      console.debug(JSON.stringify(mutation, null, 2))
    }
  } catch (err) {
    console.error(`[main]: Error encountered...`, err)
    return err
  }
}

function diffLists(allowList, ghIPs) {
  try {
    const allowListIPs = allowList.entries.map(entry => entry.node.allowListValue)
    const diff = ghIPs.filter(ip => !allowListIPs.includes(ip))

    return diff
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

async function main() {
  try {
    const octokit = new NOctokit({ auth: process.env.GH_TOKEN })

    const allowList = await getAllowList(octokit)

    const ghIPs = await getGitHubIPs(octokit)

    const listDiff = diffLists(allowList, ghIPs)

    if (listDiff.length > 0) {
      console.log('Adding missing IPs to allow list...')
      await addMissingIPs(octokit, listDiff, allowList.ownerId.id)
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
