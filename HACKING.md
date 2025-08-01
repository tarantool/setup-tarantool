## First steps

Clone the repository and install dependencies.

```shell
$ git clone git@github.com:tarantool/setup-tarantool.git
$ cd setup-tarantool
$ npm install
```

## Contribute

Edit the source and regenerate the `index.js` file.

```shell
$ vim src/main.ts
$ npm run pre-checkin
```

## Update dependencies

```shell
$ npx npm-check-updates -u
$ npm install
$ npm update
$ npm run pre-checkin
```
