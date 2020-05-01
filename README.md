# pr-tree
Display github pull request on the command line in tree view

# Usage
- Get `GITHUB_API_TOKEN` (check `repo`)
  - https://help.github.com/en/articles/creating-a-personal-access-token-for-the-command-line

- Add `GITHUB_API_TOKEN` to .bashrc or .zshrc.
  - `export GITHUB_API_TOKEN=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`

- Execute `bundle install`

- Put the script in an executable directory
  - ex) `/usr/local/bin/pr-tree`
  - `ln -s /Users/volpe/repo/github.com/volpe28v/pr-tree/bin/pr-tree /usr/local/bin/pr-tree`

- Run the following command
```
$ pr-tree
```

- Filter by user
```
$ pr-tree -f hoge
```

- Filter by reviewer
```
$ pr-tree -r hoge
```

- Specify github url
```
$ pr-tree -u ssh://git@github.com/hoge/fuga.git
```

# Example

![image](https://user-images.githubusercontent.com/754962/77252414-0cdea200-6c97-11ea-9ead-894bd9164ac9.png)
