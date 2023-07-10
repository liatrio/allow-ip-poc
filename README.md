# IP Allow Workflow POC

This repository is home to a Proof of Concept (POC) on how to create a scheduled GitHub Action Workflow that will run once a week, and on push, to check if the latest available IP addresses for GitHub Actions Runners are allowed in the IP Allow List of an organization.

## Usage

There are a couple of key components to note in this POC:

### Organization Name

This POC requires the name of the organization you want these allow rules added to. This will be passed into a GraphQL query as a string variable but it can be set in a couple of different ways.

In our POC, this is handled by an environment variable called `ORG_LOGIN`. You can store this as a repository secret or just hardcode it in the workflow file:

```yaml
- uses: actions/github-script@v6
  env:
    GH_TOKEN: ${{ secrets.GH_TOKEN }}
    ORG_LOGIN: ${{ secrets.ORG_LOGIN }}
    # ORG_LOGIN: "ORG_NAME_HERE"
  with:
    script: |
      const script = require('./main.js')
      console.log(script({github, context}))
```

### GitHub Token

This POC requires a Personal Access Token with scope `admin:org` that is set as a repository secret in GitHub named `GH_TOKEN`. This is referenced in `main.js` when accessing the GitHub API.

### Managing Other IPs using json file

This POC now has a way to read a json file called `ip.json` to add to the IP allow list.

Here is an example of how the file looks like:

```json
[
  {
    "name": "Google",
    "ipList": ["8.8.8.8"]
  },
  {
    "name": "Secondary object to categorize IPs",
    "ipList": ["IP address 1", "IP address 2"]
  }
]
```

The script will parse the `ip.json` to check the IPs if they are inside the IP allow list for the organization and add them if they do not exist in there already.
