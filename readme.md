## Installation

Install package with NPM and add it to your development dependencies:

`npm install --save-dev xplodedthemes/gulp-freemius-deploy`

## Usage

`gulp-freemius-deploy` is a task module that can be run via the command line.

In its most basic form, the configuration would look like this:

```js
var gulp = require( 'gulp' );

require( 'gulp-freemius-deploy' )( gulp, {
  "developer_id": 000,
  "plugin_id": 000,
  "zip_name": "premium-version-zip-name.zip",
  "zip_name_free": "free-version-zip-name.zip",
  "access_token": "fs-access-token",
  "add_contributor": false,
  "auto_release": true
} );
```

If your `gulpfile.js` is in a public repository, you may want to abstract the `developer_id`, `plugin_id`, `access_token`. You can do this by creating a git ignored `fs-config.json` file like so:

```json
{
  "developer_id": 000,
  "plugin_id": 000,
  "zip_name": "premium-version-zip-name.zip",
  "zip_name_free": "free-version-zip-name.zip",
  "access_token": "fs-access-token",
  "add_contributor": false,
  "auto_release": true
}
```

You can then include it in your gulpfile:

```js
var gulp = require( 'gulp' ),
    fs_config = require( './fs-config.json' );

require( 'gulp-freemius-deploy' )( gulp, fs_config );
```

Once configured, simply run this from the command line to deploy your zip to freemius:

`gulp freemius-deploy`
