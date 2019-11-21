# pr-tree
Display github pull request on the command line in tree view

# Usage
- Get `GITHUB_API_TOKEN` (check `repo`)
  - https://help.github.com/en/articles/creating-a-personal-access-token-for-the-command-line

- Add `GITHUB_API_TOKEN` to .bashrc or .zshrc.
  - `export GITHUB_API_TOKEN=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`

- Put the script in an executable directory
  - ex) `/usr/local/bin/pr-tree`
  - `ln -s /Users/volpe/repo/github.com/volpe28v/pr-tree/bin/pr-tree /usr/local/bin/pr-tree`

- Run the following command
```
$ pr-tree
```

- Filter by user
```
$ pr-tree hoge
```

# Example

![image](https://user-images.githubusercontent.com/754962/63531828-4f46d180-c544-11e9-8a50-40ffc9a7b038.png)
