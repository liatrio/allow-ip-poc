# IP Allow Workflow POC

This repository is home to a Proof of Concept (POC) on how to create a scheduled GitHub Action Workflow that will run once a week, and on push, to check if the latest available IP addresses for GitHub Actions Runners are allowed in the IP Allow List of an organization.

## Usage

There are a couple of key components to note in this POC:

### Organization Name

In the main.js file, there is the following GraphQL query:

```graphql
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
```

Note how the 2nd line has `login: "liatrio"` as that's the name of the org we're working with. If you want to use this POC for your own org, you'll need to change that value to your org's name.

### GitHub Token

This POC requires a Personal Access Token with scope `admin:org` that is set as a repository secret in GitHub named `GH_TOKEN`. This is referenced in `main.js` when accessing the GitHub API.

### GitHub Org

This POC requires a organization login name such as `liatrio` to be stored as a secret. This is referenced in `main.js` when querying the IP allow list of the organization specified.

### Managing Other IPs using json file

This POC now has a way to read a json file called `ip.json` to add to the IP allow list.

Here is an example of how the file looks like:
```json
[
    {
        "name": "Google",
        "ipList": [
            "8.8.8.8"
        ]
    },
    {
      "name": "Secondary object to categorize IPs",
      "ipList": [
        "IP address 1",
        "IP address 2"
      ]
    }
]
```

The script will parse the `ip.json` to check the IPs if they are inside the IP allow list for the organization and add them if they do not exist in there already.

